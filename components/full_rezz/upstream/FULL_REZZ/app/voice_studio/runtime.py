"""Local-only runtime and model integrity checks."""
import os, socket, hashlib, json, sys, importlib.abc, importlib.util
from pathlib import Path
APP_ROOT=Path(__file__).resolve().parents[1]
MODEL_ROOT=Path(os.environ.get('VOICE_STUDIO_MODEL_ROOT',APP_ROOT/'models'))
def workspace():return Path(os.environ.get('LOCALAPPDATA',Path.home()/'.local/share'))/'VoiceProfileStudio'/'Workspace'
class DisabledEngineLoader(importlib.abc.Loader):
 def create_module(self, spec):return None
 def exec_module(self, module):raise ImportError("ONNX Runtime is excluded from this offline release.")
class BlockOptionalTelemetryEngine(importlib.abc.MetaPathFinder):
 def find_spec(self, fullname, path=None, target=None):
  if fullname == "onnxruntime" or fullname.startswith("onnxruntime."):return importlib.util.spec_from_loader(fullname,DisabledEngineLoader(),origin="offline-disabled")
def enforce_offline():
 os.environ['VOICE_STUDIO_OFFLINE']='1'
 if not any(isinstance(f,BlockOptionalTelemetryEngine) for f in sys.meta_path):sys.meta_path.insert(0,BlockOptionalTelemetryEngine())
 for k,v in {'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1','DO_NOT_TRACK':'1','WANDB_MODE':'disabled','TOKENIZERS_PARALLELISM':'false','NUMBA_THREADING_LAYER':'workqueue','MPLBACKEND':'Agg'}.items():os.environ[k]=v
 def denied(*a,**k):raise OSError('Network access is disabled in this offline application.')
 socket.socket.connect=denied;socket.socket.connect_ex=denied;socket.create_connection=denied;socket.getaddrinfo=denied
 from . import research
 def local(*a,**k):raise ValueError("Online source retrieval is disabled. Import a local document instead.")
 for name in ["wikipedia","wikidata","fetch_source"]:setattr(research,name,local)
 def local(*a,**k):raise ValueError('Online source retrieval is disabled. Import a local document instead.')
 from . import research
 for name in ['wikipedia','wikidata','fetch_source']:setattr(research,name,local)
def model_path(name):
 p=(MODEL_ROOT/name).resolve()
 if not p.is_relative_to(MODEL_ROOT.resolve()) or not p.exists():raise ValueError('Bundled model is missing. Reinstall the complete offline package.')
 return p
def health(full=True):
 manifest=json.loads(model_path('manifest.json').read_text());results=[]
 for a in manifest['assets']:
  p=model_path(a['path']);ok=p.stat().st_size==a['bytes']
  if full:ok=ok and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==a['sha256']
  results.append({'path':a['path'],'passed':ok})
 resources=[]
 for directory in ['fonts','vendor/espeak-ng','vendor/llama-cpp']:
  root=APP_ROOT/directory;file=root/'manifest.json'
  if not file.is_file():resources.append({'group':directory,'passed':False});continue
  for a in json.loads(file.read_text())['assets']:
   p=(root/a['path']).resolve();ok=p.is_relative_to(root.resolve()) and p.is_file() and p.stat().st_size==a['bytes']
   if ok and full:ok=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==a['sha256']
   resources.append({'group':directory,'path':a['path'],'passed':ok})
 return {'offline':True,'full_sha256':full,'passed':all(a['passed'] for a in results+resources),'assets':results,'bundled_resources':resources}
