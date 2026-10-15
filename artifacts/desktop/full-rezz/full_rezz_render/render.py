"""Transactional local export through the packaged PyAV codecs; no Node/FFmpeg CLI."""
from fractions import Fraction
import hashlib, json, os, shutil, tempfile, time, wave, zlib
from pathlib import Path
import numpy as np
import av
import PySide6
from PySide6.QtCore import QBuffer, QIODevice
from .project import Project, digest
from .scene import Scene, array
from . import __version__


def save_png(raster, path):
    """Encode to memory, then fsync/rename one complete witness file."""
    buffer = QBuffer()
    if not buffer.open(QIODevice.OpenModeFlag.WriteOnly) or not raster.save(buffer,"PNG"):
        raise ValueError("Witness PNG encoding failed.")
    encoded = bytes(buffer.data()); buffer.close()
    staged = Path(path).with_suffix(".png.staged")
    with staged.open("wb") as stream:
        stream.write(encoded); stream.flush(); os.fsync(stream.fileno())
    os.replace(staged,path)


def render(project_root, output_directory, preset="production", fps=60, progress=None, capture_full_resolution=True):
    project = Project(project_root, preset, fps)
    # A missing packaged encoder produces an actionable error before rendering.
    av.Codec("libx264","w"); av.Codec("aac","w")
    target = Path(output_directory).resolve()
    if target.exists():
        raise ValueError("Choose a new output directory; existing renders are preserved.")
    if target == project.root or target.is_relative_to(project.root):
        raise ValueError("Keep rendered output outside the source project.")
    target.parent.mkdir(parents=True, exist_ok=True)
    raw_bytes = project.preset["width"]*project.preset["height"]*3*project.clock.frames
    if capture_full_resolution and shutil.disk_usage(tempfile.gettempdir()).free < raw_bytes + 256*1024*1024:
        raise ValueError("Not enough disk space for the exhaustive raster reference.")
    stage = Path(tempfile.mkdtemp(prefix=".full-rezz-render-",dir=target.parent))
    raw_work = Path(tempfile.mkdtemp(prefix="full-rezz-raster-")) if capture_full_resolution else None
    started = time.monotonic()
    try:
        scene = Scene(project)
        movie = stage / "Rebecca_Full_Voiced_Action.mp4"
        audio_path = stage / "sequence.audio.wav"
        sample_count = round(float(project.clock.duration)*24000)
        samples = np.zeros(sample_count,dtype="<i2")
        onset = round(project.offset*24000)
        samples[onset:onset+project.speech_samples] = np.frombuffer(project.speech,dtype="<i2")
        with wave.open(str(audio_path),"wb") as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(24000); wav.writeframes(samples.tobytes())
        (stage/"witnesses").mkdir()
        # Inspect held frames, exact authored boundaries, facial motion and closing hold.
        witnesses = sorted(set([0, min(project.clock.frames-1,round(5.875*fps)), min(project.clock.frames-1,round(8.04*fps)), project.clock.frames-1]))
        records, witness_hashes = [], {}
        reference = stage/"raster_reference.zlib"
        compressor = zlib.compressobj(6)
        audio_position = 0
        from contextlib import nullcontext
        raw_path = raw_work/"full_resolution.rgb" if raw_work else stage/"full_resolution.rgb"
        raw_hash = hashlib.sha256()
        with av.open(str(movie),"w",format="mp4",options={"movflags":"+faststart"}) as container, reference.open("wb") as refs, (raw_path.open("wb") if capture_full_resolution else nullcontext(None)) as raw:
            video = container.add_stream("libx264",rate=fps)
            video.width = scene.width; video.height = scene.height; video.pix_fmt = "yuv420p"
            video.options = {"crf":str(project.preset["crf"]),"preset":"medium","threads":"2"}
            video.time_base = Fraction(1,fps)
            audio = container.add_stream("aac",rate=24000); audio.layout = "mono"; audio.bit_rate = 192000
            container.metadata["title"] = "FULL_REZZ 2.1 render and audit refinement"
            container.metadata["comment"] = "Authored cels; mixed procedural exposure cadence; energy mouth synchronization; studio equivalence unverified."
            for index in range(project.clock.frames):
                while audio_position < sample_count and Fraction(audio_position,24000) <= Fraction(index,fps):
                    values = samples[audio_position:audio_position+1024].astype(np.float32)[None,:]/32768
                    audio_frame = av.AudioFrame.from_ndarray(values,format="fltp",layout="mono")
                    audio_frame.sample_rate = 24000; audio_frame.pts = audio_position; audio_frame.time_base = Fraction(1,24000)
                    for packet in audio.encode(audio_frame): container.mux(packet)
                    audio_position += values.shape[1]
                raster, thumb, mask, state = scene.render(index)
                rgb = array(raster)[:,:,:3]
                pixel_bytes = rgb.tobytes()
                state["raw_rgb_sha256"] = hashlib.sha256(pixel_bytes).hexdigest()
                if raw is not None: raw.write(pixel_bytes); raw_hash.update(pixel_bytes)
                state["thumbnail_sha256"] = hashlib.sha256(thumb.tobytes()).hexdigest()
                state["actor_matte_sha256"] = hashlib.sha256(mask.tobytes()).hexdigest()
                refs.write(compressor.compress(thumb.tobytes()+mask.tobytes()))
                records.append(state)
                if index in witnesses:
                    png = stage/"witnesses"/f"frame_{index:04d}.png"
                    save_png(raster,png)
                    witness_hashes[str(index)] = digest(png)
                frame = av.VideoFrame.from_ndarray(np.ascontiguousarray(rgb),format="rgb24")
                frame.pts = index; frame.time_base = Fraction(1,fps)
                for packet in video.encode(frame): container.mux(packet)
                if progress and (index%60==0 or index==project.clock.frames-1): progress(index+1,project.clock.frames)
            while audio_position < sample_count:
                values = samples[audio_position:audio_position+1024].astype(np.float32)[None,:]/32768
                frame = av.AudioFrame.from_ndarray(values,format="fltp",layout="mono")
                frame.sample_rate=24000; frame.pts=audio_position; frame.time_base=Fraction(1,24000)
                for packet in audio.encode(frame):container.mux(packet)
                audio_position+=values.shape[1]
            for stream in [video,audio]:
                for packet in stream.encode():container.mux(packet)
            refs.write(compressor.flush()); refs.flush(); os.fsync(refs.fileno())
            if raw is not None: raw.flush(); os.fsync(raw.fileno())
        project.verify_unchanged()
        receipt = {"schema_version":"1.0.0","renderer_version":__version__,"preset":preset,"fps":fps,"frames":project.clock.frames,
            "duration_seconds":float(project.clock.duration),"dimensions":[scene.width,scene.height],"internal_dimensions":list(scene.internal),
            "supersampling":project.preset["supersampling"],"crf":project.preset["crf"],"codec":"libx264/yuv420p + AAC/mono/24kHz",
            "backend":"Qt QImage/QPainter, NumPy premultiplied triangle sampling, PyAV","runtime_dependencies":{"av":av.__version__,"numpy":np.__version__,"PySide6":PySide6.__version__},
            "asset_sha256":project.assets,"config":project.config,"source_speech_samples":project.speech_samples,"speech_offset_samples":onset,
            "source_voice_sha256":project.assets["assets/statement.original.wav"],"output_sha256":{movie.name:digest(movie),audio_path.name:digest(audio_path),reference.name:digest(reference)},
            "raster_reference":{"rgb_dimensions":[128,72],"matte_dimensions":[320,180],"layout":"frame RGB uint8 followed by frame alpha uint8, all frames, one zlib stream"},
            "witness_sha256":witness_hashes,"witnesses":witnesses,"frame_evidence":records,"elapsed_seconds":round(time.monotonic()-started,3),
            "arbitrary_new_action_generation":False,"phoneme_alignment":False,"human_quality_review":"pending","studio_equivalence_validated":False,
            "filter":"Qt SmoothTransformation; sRGB 8-bit compositing; supersampling does not add source drawing detail"}
        if capture_full_resolution:
            receipt["full_resolution_reference"]={"name":raw_path.name,"bytes":raw_bytes,"sha256":raw_hash.hexdigest(),"format":"RGB24, row-major frames"}
        (stage/"render_receipt.json").write_text(json.dumps(receipt,indent=2)+"\n")
        timeline = {"schema_version":"4.0.0","name":"FULL_REZZ mixed-exposure production test","fps":fps,"duration_seconds":float(project.clock.duration),
            "voice_offset_seconds":project.offset,"keys":[project.clock.output_key(k) for k in project.clock.keys],"exposures":project.config["exposures"],
            "source_fps":project.config["source_fps"],"timing_basis":"Authored keys retain their original times; procedural arm/breath samples use held 24 Hz ones/twos/threes. Face and camera use delivery fps.",
            "lip_sync":"Energy drive, no phoneme inference","camera":"Full-body push, 1.8% over 12 seconds; ground pivot"}
        (stage/"action_timeline.json").write_text(json.dumps(timeline,indent=2)+"\n")
        for path in stage.rglob("*"):
            if path.is_file():
                with path.open("rb") as stream: os.fsync(stream.fileno())
        # The target is unique; failed jobs never expose a partial MP4 as a finished render.
        if target.exists(): raise ValueError("Another job claimed the output directory.")
        os.rename(stage,target)
        return {k:receipt[k] for k in ["renderer_version","preset","fps","frames","dimensions","internal_dimensions","elapsed_seconds"]} | {"output_directory":str(target),"raw_reference_path":str(raw_path) if raw_work else None}
    except BaseException:
        shutil.rmtree(stage,ignore_errors=True)
        if raw_work:shutil.rmtree(raw_work,ignore_errors=True)
        raise
