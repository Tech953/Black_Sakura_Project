"""Spectral energy is descriptive and separate from pitch and delivery."""
import numpy as np
from scipy.signal import welch
from .audio import mono,resample
BANDS={'bass':(20,250),'mid':(250,2000),'treble':(2000,8000),'upper':(8000,12000)}
def measure(data,sr):
 x=resample(mono(data),sr,24000)
 if len(x)<960 or not np.isfinite(x).all() or np.max(np.abs(x))<1e-8:return {'available':False,'reason':'No measurable signal.'}
 def energy(f,p,a,b):
  idx=(f>a)&(f<b);return float(np.trapezoid(np.r_[np.interp(a,f,p),p[idx],np.interp(b,f,p)],np.r_[a,f[idx],b]))
 f,p=welch(x,24000,window='hann',nperseg=960,noverlap=480,nfft=4096,detrend='constant')
 energies={k:energy(f,p,*v) for k,v in BANDS.items()};total=sum(energies.values());frames=[]
 for i in range(0,len(x)-959,480):
  y=x[i:i+960]
  if np.sqrt(np.mean(y*y))<10**(-50/20):continue
  ff,pp=welch(y,24000,window='hann',nperseg=960,noverlap=0,nfft=4096,detrend='constant');ee={k:energy(ff,pp,*v) for k,v in BANDS.items()};tt=sum(ee.values())
  if tt>0:frames.append({k:100*v/tt for k,v in ee.items()})
 return {'available':total>0,'band_percent':{k:100*v/total for k,v in energies.items()},'frame_percentiles':{k:np.percentile([r[k] for r in frames],[10,50,90]).tolist() for k in BANDS} if frames else {},'bands_hz':BANDS,'method':'24 kHz anti-aliased mono; Hann Welch 40ms /20ms hop, nFFT4096, constant detrend; interpolated trapezoidal integration; 20-12000 Hz normalized energy. Frame floor -50 dBFS is not VAD.','limits':['Different words, delivery and background sound affect energy.','Resampling does not restore bandwidth.','Pitch, identity, emotion and perceptual likeness are separate.']}
def compare(reference,generated):return {'reference':reference,'generated':generated,'percentage_point_delta':{k:generated['band_percent'][k]-reference['band_percent'][k] for k in BANDS} if reference.get('available') and generated.get('available') else {},'controlled_comparison':False,'spectral_agreement_verified':False}
