import hashlib,importlib.abc,ipaddress,json,os,socket,sys,threading
from pathlib import Path
_active=False;_verified={};_lock=threading.RLock()
def enabled():return os.environ.get('VOICE_STUDIO_OFFLINE')=='1'
def model_root():return Path(__file__).resolve().parents[1]/'bundled_models'
def _local(host):
 if host in ('localhost',b'localhost',None,''):return True
 try:return ipaddress.ip_address(host.decode() if isinstance(host,bytes) else str(host)).is_loopback
 except ValueError:return False
class Denied(importlib.abc.Loader):
 def create_module(self,spec):return None
 def exec_module(self,module):raise ImportError('FULL_REZZ does not load ONNX Runtime.')
class Block(importlib.abc.MetaPathFinder):
 def find_spec(self,fullname,path=None,target=None):
  if fullname=='onnxruntime' or fullname.startswith('onnxruntime.'):
   from importlib.util import spec_from_loader
   return spec_from_loader(fullname,Denied())
def activate():
 global _active
 if _active:return
 os.environ.update(VOICE_STUDIO_OFFLINE='1',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1',DO_NOT_TRACK='1',PYANNOTE_METRICS_ENABLED='0',TOKENIZERS_PARALLELISM='false',NUMBA_DISABLE_JIT='1')
 connect=socket.socket.connect;connect_ex=socket.socket.connect_ex;dns=socket.getaddrinfo
 def local_connect(sock,address):
  if sock.family in (socket.AF_INET,socket.AF_INET6) and not _local(address[0]):raise OSError('Offline mode blocks external connections.')
  return connect(sock,address)
 def local_connect_ex(sock,address):
  if sock.family in (socket.AF_INET,socket.AF_INET6) and not _local(address[0]):raise OSError('Offline mode blocks external connections.')
  return connect_ex(sock,address)
 def local_dns(host,*args,**kwargs):
  if not _local(host):raise OSError('Offline mode blocks external DNS.')
  return dns(host,*args,**kwargs)
 socket.socket.connect=local_connect;socket.socket.connect_ex=local_connect_ex;socket.getaddrinfo=local_dns;sys.meta_path.insert(0,Block());_active=True
def verify_models():
 root=model_root();manifest=json.loads((root/'manifest.json').read_text())
 with _lock:
  for e in manifest['files']:
   p=(root/e['path']).resolve()
   if not p.is_relative_to(root.resolve()) or not p.is_file():raise ValueError('A bundled model is missing. Reinstall FULL_REZZ.')
   s=p.stat();key=(str(p),s.st_size,s.st_mtime_ns,e['sha256'])
   if key in _verified:continue
   if s.st_size!=e['size_bytes']:raise ValueError('Bundled model size check failed.')
   h=hashlib.sha256()
   with p.open('rb') as stream:
    while block:=stream.read(4*1024*1024):h.update(block)
   if h.hexdigest()!=e['sha256']:raise ValueError('Bundled model checksum failed.')
   _verified[key]=True
 return manifest
def asset_group(key):verify_models();return model_root()/key
