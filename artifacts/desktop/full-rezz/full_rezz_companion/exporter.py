"""Atomic offline exports of actual authored geometry and delivered speech."""
from pathlib import Path
from fractions import Fraction
import hashlib,json,math,os,time,uuid
import numpy as np
from .gltf import SurfaceModel
from .raster import render_surfaces
from .performance import PerformanceController,ShotTimeline,benchmark_shots
from .characters import local_path

def movie_plan(fps,audio_seconds=0):
    if type(fps) is not int or fps not in (60,120,240):raise ValueError('Choose 60, 120 or 240 fps.')
    if not math.isfinite(audio_seconds) or not 0<=audio_seconds<=180:raise ValueError('Speech must be at most 180 seconds.')
    frames=max(12*fps,math.ceil((audio_seconds+.5)*fps));shots=benchmark_shots(fps);shots[-1]['end_frame']=frames
    return ShotTimeline(shots,fps,frames)

def export_movie(session,pid,mode,view_id,clip,action,fps,path,turn_id=None,width=1280,height=720):
    import av
    if type(width) is not int or type(height) is not int or not 64<=width<=1920 or not 64<=height<=1080 or width%2 or height%2:raise ValueError('Choose even dimensions within 64–1920 by 64–1080.')
    session.characters.ensure_profile(session.studio.profile(pid));character=session.characters.select(pid,mode,view_id if mode=='2d' else None)
    rep=character['two_d'] if mode=='2d' else character['three_d'];view=next(v for v in rep['views'] if v['view_id']==view_id) if mode=='2d' else None
    if action not in (view or rep).get('supported_actions',['idle','talk']):raise ValueError('This action needs additional authored assets.')
    speech=None
    if turn_id:
        with session.history.connect() as db:row=db.execute('SELECT receipt FROM turns WHERE id=?',(turn_id,)).fetchone()
        if row is None:raise ValueError('Conversation turn not found.')
        receipt=json.loads(row[0])
        if receipt['profile_id']!=pid:raise ValueError('Speech belongs to another character.')
        if receipt.get('audio_status')=='ready':speech=Path(receipt['speech']['audio_path'])
    performance=PerformanceController()
    if speech:performance.load(speech)
    plan=movie_plan(fps,performance.duration if speech else 0);root=session.characters.asset_root(character);target=Path(path).resolve()
    if target.suffix.lower()!='.webm':raise ValueError('Use a .webm filename.')
    if target.is_relative_to(root.resolve()) or speech and target==speech.resolve():raise ValueError('Export outside the character assets and speech file.')
    target.parent.mkdir(parents=True,exist_ok=True);stage=target.with_name(target.stem+'.'+uuid.uuid4().hex+'.partial.webm');started=time.perf_counter()
    if mode=='3d':
        model=SurfaceModel.load(local_path(root,rep['asset']));joints=rep.get('joint_mapping',{})
        if clip is not None and (type(clip) is not int or not 0<=clip<len(model.animations)):raise ValueError('Invalid authored clip index.')
    else:
        os.environ.setdefault('QT_QPA_PLATFORM','offscreen')
        from PySide6.QtWidgets import QApplication
        from PySide6.QtGui import QImage,QPainter
        from .qt import CelViewport
        qapp=QApplication.instance() or QApplication([]);cel=CelViewport();cel.set_view(view,root)
    try:
        with av.open(str(stage),'w',format='webm') as output:
            video=output.add_stream('libvpx-vp9',rate=fps);video.width=width;video.height=height;video.pix_fmt='yuv420p';video.options={'crf':'20','b':'0','deadline':'good','cpu-used':'4','row-mt':'1'}
            audio=output.add_stream('libopus',rate=48000) if speech else None
            for i in range(plan.frames):
                t=i/fps;energy=performance.aperture(t) if speech else 0.;state='talk' if energy>0 and action=='idle' else action
                if mode=='3d':rgba=render_surfaces(model.surfaces(t,clip,PerformanceController.overrides(model,joints,t,energy,state)),width,height,plan.at(i))
                else:
                    cel.animation_time=t;cel.energy=energy;cel.action=state;image=QImage(width,height,QImage.Format_RGBA8888);painter=QPainter(image);cel.draw(painter,width,height);painter.end();rgba=np.frombuffer(image.bits(),np.uint8).reshape(height,image.bytesPerLine())[:,:width*4].reshape(height,width,4).copy()
                frame=av.VideoFrame.from_ndarray(rgba,format='rgba');frame.pts=i;frame.time_base=Fraction(1,fps)
                for packet in video.encode(frame):output.mux(packet)
                if i%fps==0:print(json.dumps({'exported_frame':i,'total_frames':plan.frames}),flush=True)
            for packet in video.encode():output.mux(packet)
            if speech:
                audio.layout='mono';resampler=av.AudioResampler(format='fltp',layout='mono',rate=48000)
                with av.open(str(speech)) as source:
                    for decoded in source.decode(audio=0):
                        for frame in resampler.resample(decoded):
                            for packet in audio.encode(frame):output.mux(packet)
                    for frame in resampler.resample(None):
                        for packet in audio.encode(frame):output.mux(packet)
                for packet in audio.encode():output.mux(packet)
        with av.open(str(stage)) as check:
            if check.streams.video[0].average_rate!=fps:raise ValueError('Delivery rate changed during encoding.')
            count=0;previous=None
            for frame in check.decode(video=0):
                position=frame.pts*frame.time_base
                if previous is not None and position<=previous:raise ValueError('Movie timestamps are not increasing.')
                previous=position;count+=1
            if count!=plan.frames:raise ValueError('Movie frame count changed during encoding.')
        audio_seconds=None
        if speech:
            with av.open(str(stage)) as check:audio_seconds=sum(f.samples/f.sample_rate for f in check.decode(audio=0))
            if abs(audio_seconds-performance.duration)>.1:raise ValueError('Encoded speech duration changed unexpectedly.')
        with stage.open('rb') as file:sha=hashlib.file_digest(file,'sha256').hexdigest()
        result={'profile_id':pid,'mode':mode,'view_id':view_id if mode=='2d' else None,'path':str(target),'sha256':sha,'fps':fps,'frames':count,'duration_seconds':plan.frames/fps,'resolution':[width,height],'turn_id':turn_id,
                'speech_source_sha256':performance.audio_sha256 if speech else None,'encoded_audio_seconds':audio_seconds,'mouth_alignment':'actual WAV energy; not phonemes','original_WAV_retained':True,'movie_audio_is_lossless':False,
                'shots':plan.shots if mode=='3d' else [{'shot_id':'selected_authored_2d_view','view_id':view_id,'start_frame':0,'end_frame':plan.frames}],
                'elapsed_seconds':time.perf_counter()-started,'all_video_frames_decoded_and_timestamps_checked':True,'render_backend':'independent CPU depth renderer' if mode=='3d' else 'shared Qt cel painter',
                'new_speech_generated_by_export':False,'missing_views_or_geometry_generated':False,'live_frame_rate_benchmark':False,'artistic_acceptance':False}
        os.replace(stage,target);target.with_suffix('.audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');return result
    finally:
        if stage.exists():stage.unlink()
