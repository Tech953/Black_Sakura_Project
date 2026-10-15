from functools import lru_cache
import os,numpy as np
from scipy.cluster.hierarchy import linkage,fcluster
from . import audio,offline
@lru_cache(maxsize=1)
def _encoder():
 import torch
 from speechbrain.inference.classifiers import EncoderClassifier
 from speechbrain.utils.fetching import LocalStrategy
 torch.set_num_threads(max(1,min(os.cpu_count() or 4,6)));p=offline.asset_group('ecapa')
 return EncoderClassifier.from_hparams(source=str(p),savedir=str(p),overrides={'pretrained_path':str(p)},run_opts={'device':'cpu'},local_strategy=LocalStrategy.COPY)
def embedding(data,sr):
 import torch
 x=audio.resample(audio.mono(data),sr)
 if len(x)<1600:raise ValueError('Speaker grouping requires at least 0.1 seconds.')
 with torch.inference_mode():v=_encoder().encode_batch(torch.from_numpy(x[None])).detach().cpu().numpy().reshape(-1)
 if len(v)!=192 or not np.isfinite(v).all():raise ValueError('Invalid local embedding.')
 return v.astype(np.float64)
def diarize(data,sr,count=None):
 if count is not None and (isinstance(count,bool) or not isinstance(count,int) or not 1<=count<=20):raise ValueError('Speaker count must be between 1 and 20.')
 x=audio.mono(data);windows=[]
 for a,b in audio.activity_regions(x,sr):
  start=a
  while start<b:
   end=min(b,start+1.5)
   if end-start>=.15:windows.append((start,end))
   if end==b:break
   start+=.75
 if len(windows)>2400:raise ValueError('Split the recording before speaker grouping.')
 if not windows:return {'segments':[],'exclusive_segments':[],'embeddings':{},'backend':'local-ecapa-energy-clustering','note':'No activity detected.'}
 vectors=np.stack([embedding(x[round(a*sr):round(b*sr),None],sr) for a,b in windows]);unit=vectors/np.maximum(np.linalg.norm(vectors,axis=1,keepdims=True),1e-12)
 if len(vectors)==1:labels=np.ones(1,dtype=int)
 else:
  tree=linkage(unit,method='average',metric='cosine');labels=fcluster(tree,t=min(count,len(windows)),criterion='maxclust') if count else fcluster(tree,t=.32,criterion='distance')
 segments=[]
 for i,((a,b),label) in enumerate(zip(windows,labels)):
  if i and windows[i-1][1]>a:a=(windows[i-1][1]+a)/2
  if i+1<len(windows) and windows[i+1][0]<b:b=(b+windows[i+1][0])/2
  speaker=f'VOICE_{int(label):02d}'
  if segments and segments[-1]['speaker']==speaker and abs(segments[-1]['end']-a)<.001:segments[-1]['end']=b
  elif b>a:segments.append({'start':a,'end':b,'speaker':speaker,'channel':None,'purity':'unreviewed','text':'','style':'neutral'})
 return {'segments':segments,'exclusive_segments':[],'embeddings':{f'VOICE_{int(l):02d}':vectors[labels==l].mean(axis=0).tolist() for l in sorted(set(labels))},'embedding_model':'speechbrain/spkrec-ecapa-voxceleb@0f99f2d','backend':'local-ecapa-energy-clustering','note':'Anonymous energy-window/cosine groups; no overlapping speech or identity verification. All regions require listening review.'}
