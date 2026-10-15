"""Bundled CPU inference. No model downloads or silent substitutions."""
import os
import numpy as np
from .audio import mono,resample,activity_regions
from .runtime import enforce_offline,model_path,workspace
def threads():
 enforce_offline()
 import torch
 torch.set_num_threads(min(4,os.cpu_count() or 1));return torch
def capabilities():return {'pyannote':model_path('speaker').is_dir(),'transcription':model_path('asr').is_dir(),'separation':model_path('separator').is_dir(),'note':'Anonymous clustering; no overlap detection or identity verification.'}
def transcribe(data,sr,model='base',language=None):
 from .languages import canonical
 selected=canonical(language,automatic=True);language=None if selected=='auto' else ('zh' if selected=='zh-Hans' else selected)
 enforce_offline()
 from faster_whisper import WhisperModel
 engine=WhisperModel(str(model_path('asr')),device='cpu',compute_type='int8',cpu_threads=4,local_files_only=True)
 segments,info=engine.transcribe(resample(mono(data),sr,16000),language=language or None,word_timestamps=True,vad_filter=False,beam_size=5)
 rows=[{'start':float(s.start),'end':float(s.end),'text':s.text.strip(),'words':[{'start':float(w.start),'end':float(w.end),'word':w.word,'probability':float(w.probability)} for w in (s.words or [])]} for s in segments]
 return {'requested_language':selected,'segments':rows,'language':info.language,'language_probability':float(info.language_probability),'model':'bundled-base-multilingual','backend':'faster-whisper-cpu-int8'}
def diarize(data,sr,count=None,model=None):
 torch=threads()
 from speechbrain.inference.speaker import EncoderClassifier
 from speechbrain.utils.fetching import LocalStrategy
 from scipy.cluster.hierarchy import linkage,fcluster,cut_tree
 x=resample(mono(data),sr,16000);spans=[{'start':round(a*16000),'end':round(b*16000)} for a,b in activity_regions(x,16000)]
 source=model_path('speaker');engine=EncoderClassifier.from_hparams(source=str(source),savedir=str(workspace().parent/'ModelCache/speaker'),run_opts={'device':'cpu'},overrides={'pretrained_path':str(source)},local_strategy=LocalStrategy.COPY)
 windows=[];vectors=[]
 for span in spans:
  a,b=span['start']/16000,span['end']/16000
  for start in np.arange(a,max(a+.001,b-1),1):
   end=min(b,start+2);y=x[round(start*16000):round(end*16000)];y=np.pad(y,(0,max(0,8000-len(y))))
   with torch.inference_mode():v=engine.encode_batch(torch.from_numpy(y[None])).reshape(-1).cpu().numpy()
   vectors.append(v/max(float(np.linalg.norm(v)),1e-9));windows.append((float(start),float(end),a,b))
 if not vectors:return {'segments':[],'embeddings':{},'exclusive_segments':[],'backend':'Local energy activity + ECAPA clustering','note':'No speech detected.'}
 if len(vectors)==1:labels=np.zeros(1,dtype=int)
 else:
  z=linkage(np.array(vectors),method='average',metric='cosine');labels=cut_tree(z,n_clusters=min(count,len(vectors))).ravel() if count else fcluster(z,.45,criterion='distance')
 mapping={};rows=[];embeds={}
 for i,(a,b,turna,turnb) in enumerate(windows):
  label=int(labels[i]);mapping.setdefault(label,f'SPEAKER_{len(mapping):02d}');speaker=mapping[label]
  start=turna if i==0 or windows[i-1][2:]!=(turna,turnb) else (a+b+windows[i-1][0]+windows[i-1][1])/4
  end=turnb if i==len(windows)-1 or windows[i+1][2:]!=(turna,turnb) else (a+b+windows[i+1][0]+windows[i+1][1])/4
  if end<=start:continue
  if rows and rows[-1]['speaker']==speaker and abs(rows[-1]['end']-start)<.001:rows[-1]['end']=end
  else:rows.append({'start':start,'end':end,'speaker':speaker,'channel':None,'purity':'unreviewed','text':'','style':'neutral'})
  embeds.setdefault(speaker,[]).append(vectors[i])
 return {'requested_language':selected,'segments':rows,'exclusive_segments':[],'embeddings':{k:np.mean(v,axis=0).astype(float).tolist() for k,v in embeds.items()},'embedding_model':'ECAPA VoxCeleb','backend':'Local energy activity + ECAPA average-link cosine clustering','note':'Anonymous clusters require listening; no overlap detection or named identity verification.'}
def separate(data,sr,cache):
 if len(data)/sr>30:raise ValueError('Separate up to 30 seconds.')
 torch=threads()
 from speechbrain.inference.separation import SepformerSeparation
 from speechbrain.utils.fetching import LocalStrategy
 engine=SepformerSeparation.from_hparams(source=str(model_path('separator')),savedir=str(workspace().parent/'ModelCache/separator'),run_opts={'device':'cpu'},local_strategy=LocalStrategy.COPY)
 with torch.inference_mode():result=engine.separate_batch(torch.from_numpy(resample(mono(data),sr,8000)[None]))[0].cpu().numpy().astype(np.float32)
 if result.ndim!=2 or result.shape[1]!=2 or not np.isfinite(result).all():raise ValueError('Invalid separated output.')
 return 8000,result
