"""Speech-energy timing and articulated controls without torso/hand coupling."""
import math, wave
from pathlib import Path
import numpy as np
from .gltf import quaternion_matrix, z_rotation

class PerformanceController:
    def __init__(self):self.energy=np.zeros(1);self.duration=0.;self.sample_rate=0;self.audio_sha256=None
    def load(self,path):
        import hashlib
        path=Path(path)
        with wave.open(str(path),'rb') as w:
            if w.getsampwidth()!=2 or w.getnchannels()!=1:raise ValueError('Live performance uses delivered mono PCM16 WAV.')
            self.sample_rate=w.getframerate();samples=np.frombuffer(w.readframes(w.getnframes()),'<i2').astype(float)/32768
        if not len(samples) or not np.isfinite(samples).all():raise ValueError('Delivered speech is empty or invalid.')
        self.duration=len(samples)/self.sample_rate;window=max(1,round(self.sample_rate/120));pad=(-len(samples))%window
        values=np.sqrt(np.mean(np.pad(samples,(0,pad)).reshape(-1,window)**2,axis=1));scale=max(float(np.percentile(values,90)),.01)
        drive=0.;out=[]
        for value in values:
            value=float(np.clip(value/scale,0,1));tau=.035 if value>drive else .065
            drive+=(value-drive)*(1-math.exp(-window/(self.sample_rate*tau)));out.append(drive)
        self.energy=np.asarray(out);self.audio_sha256=hashlib.sha256(path.read_bytes()).hexdigest()
        return {'duration_seconds':self.duration,'sample_rate_hz':self.sample_rate,'audio_sha256':self.audio_sha256,
                'alignment':'energy_only','phoneme_alignment':False,'clock':'audio samples / sink processed microseconds'}
    def aperture(self,audio_seconds,playing=True):
        if not playing or not 0<=audio_seconds<self.duration:return 0.
        index=min(len(self.energy)-1,max(0,int(audio_seconds*120)))
        return float(np.clip((self.energy[index]-.075)/.85,0,1))
    @staticmethod
    def overrides(model,joints,time,energy=0.,action='idle'):
        if action not in ('idle','talk','gesture','step'):raise ValueError('Unsupported authored performance state.')
        out={}
        def rotate(name,angle):
            if name not in joints:return
            index=joints[name];base=model.nodes[index].get('rotation',[0,0,0,1]);x,y,z,w=base;a,b,c,d=z_rotation(angle)
            out[index]={'rotation':[w*a+x*d+y*c-z*b,w*b-x*c+y*d+z*a,w*c+x*b-y*a+z*d,w*d-x*a-y*b-z*c]}
        if 'jaw' in joints:
            i=joints['jaw'];t=list(model.nodes[i].get('translation',[0,0,0]));t[1]-=.035*energy;out[i]={'translation':t}
        if action=='gesture':
            envelope=math.sin(math.pi*min(1,max(0,(time%3)/3)))**2
            rotate('right_shoulder',-.95*envelope);rotate('right_elbow',-.45*envelope)
            rotate('right_wrist',.15*math.sin(time*7)*envelope)
        elif action=='talk':
            rotate('right_elbow',-.12*energy);rotate('left_elbow',.09*energy)
        elif action=='step':
            # An authored demo step cycle; it does not infer an anime sidestep.
            phase=(time%2)/2;waveform=math.sin(phase*2*math.pi)
            rotate('left_hip',.25*waveform);rotate('right_hip',-.25*waveform)
            rotate('left_knee',-.35*max(0,waveform));rotate('right_knee',.35*max(0,-waveform))
        return out

class ShotTimeline:
    def __init__(self,shots,fps=60,frames=720):
        if type(fps) is not int or fps not in (60,120,240):raise ValueError('Delivery supports 60, 120 or 240 fps.')
        if type(frames) is not int or frames<1:raise ValueError('Invalid frame count.')
        self.fps=fps;self.frames=frames;self.shots=shots;cursor=0
        for shot in shots:
            if shot.get('start_frame')!=cursor or type(shot.get('end_frame')) is not int or not cursor<shot['end_frame']<=frames:raise ValueError('Shots must cover the timeline without gaps/overlaps.')
            for key in ('azimuth_deg','elevation_deg','radius','target_y'):
                if type(shot.get(key)) not in (int,float) or not math.isfinite(shot[key]):raise ValueError('Invalid camera parameter.')
            if not .2<=shot['radius']<=100 or not -85<=shot['elevation_deg']<=85:raise ValueError('Camera outside the supported range.')
            cursor=shot['end_frame']
        if cursor!=frames:raise ValueError('Shots must cover every output frame.')
    def at(self,frame):
        if type(frame) is not int or not 0<=frame<self.frames:raise ValueError('Frame outside the timeline.')
        return next(s for s in self.shots if s['start_frame']<=frame<s['end_frame'])

def benchmark_shots(fps=60):
    settings=[('wide_front',0,5,3.2,.95),('medium_reaction',0,8,2.35,1.13),
              ('three_quarter',45,5,2.8,1.0),('profile',90,5,2.9,1.0),
              ('rear_three_quarter',145,9,2.9,1.08),('low_angle',-35,-15,2.9,.98)]
    return [{'shot_id':name,'start_frame':i*2*fps,'end_frame':(i+1)*2*fps,'azimuth_deg':yaw,'elevation_deg':pitch,'radius':radius,'target_y':target} for i,(name,yaw,pitch,radius,target) in enumerate(settings)]

def camera_matrix(width,height,camera):
    yaw=math.radians(camera.get('azimuth_deg',0));pitch=math.radians(camera.get('elevation_deg',5));radius=camera.get('radius',3)
    target=np.array([0,camera.get('target_y',.95),0.]);eye=target+radius*np.array([math.sin(yaw)*math.cos(pitch),math.sin(pitch),math.cos(yaw)*math.cos(pitch)])
    forward=(target-eye)/np.linalg.norm(target-eye);right=np.cross(forward,[0,1,0]);right/=np.linalg.norm(right);up=np.cross(right,forward)
    view=np.eye(4);view[:3,:3]=np.stack([right,up,-forward]);view[:3,3]=-view[:3,:3]@eye
    near=.05;far=100;f=1/math.tan(math.radians(camera.get('fov_deg',38))/2);projection=np.zeros((4,4));projection[0,0]=f/(width/height);projection[1,1]=f;projection[2,2]=(far+near)/(near-far);projection[2,3]=2*far*near/(near-far);projection[3,2]=-1
    return projection@view
