from pathlib import Path
import zipfile,urllib.request,shutil,json,hashlib
P=Path(__file__).resolve().parents[1];R=P/'build/package';R.mkdir(parents=True,exist_ok=True);archive=P/'build/python-3.11.9-embed-amd64.zip'
if not archive.exists():urllib.request.urlretrieve('https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip',archive)
manifest=P/'models/manifest.json'
if not manifest.exists():raise RuntimeError('Finish and verify all model downloads before assembly.')
for a in json.loads(manifest.read_text())['assets']:
 p=P/'models'/a['path']
 if p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']:raise RuntimeError('Model verification failed before assembly.')
with zipfile.ZipFile(archive) as z:z.extractall(R/'python')
site=R/'python/Lib/site-packages';site.mkdir(parents=True,exist_ok=True);inventory=[]
def allowed(name):
 p=Path(name);a=p.parts
 if any(x.startswith('.') or x=='__pycache__' for x in a) or a[0].startswith('onnxruntime'):return False
 if p.suffix.lower() in ('.lib','.exp','.pdb','.pyc'):return False
 if a[:2] in [('torch','include'),('PySide6','qml')]:return False
 if len(a)>2 and a[:2]==('PySide6','plugins') and a[2] in ('designer','sqldrivers','qmltooling','platforminputcontexts'):return False
 if p.name=='qpdf.dll' or ('ffmpeg' in p.name.lower() and p.suffix=='.pyd') or p.name.startswith('tbbpool'):return False
 return True
for wheel in sorted((P.parent/'win-wheels').glob('*.whl')):
 inventory.append({'name':wheel.name,'bytes':wheel.stat().st_size,'sha256':hashlib.file_digest(wheel.open('rb'),'sha256').hexdigest()})
 with zipfile.ZipFile(wheel) as z:
  for member in z.infolist():
   if member.is_dir():continue
   name=member.filename;a=name.split('/')
   if '.data' in a[0]:
    if a[1] in ('purelib','platlib'):name='/'.join(a[2:])
    else:continue
   if allowed(name):
    p=site/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(z.read(member))
for p in site.rglob('*.dll'):
 if p.name.lower().startswith(('msvcp140','vcruntime140','concrt140','vcomp140')):shutil.copy2(p,R/'python'/p.name)
(R/'python/python311._pth').write_text('python311.zip\n.\nLib/site-packages\n../app\nimport site\n')
(site/'sitecustomize.py').write_text("import os,pathlib\n_dll_handle=os.add_dll_directory(str(pathlib.Path(__file__).resolve().parents[2]))\nos.environ['HF_HUB_OFFLINE']='1'\nos.environ['TRANSFORMERS_OFFLINE']='1'\nos.environ['HF_HUB_DISABLE_TELEMETRY']='1'\nos.environ['NUMBA_THREADING_LAYER']='workqueue'\n")
p=site/'f5_tts/model/__init__.py';s='\n'.join(l for l in p.read_text().splitlines() if 'trainer import Trainer' not in l);p.write_text(s.replace('"Trainer",','').replace(', "Trainer"','')+'\n')
app=R/'app';app.mkdir(exist_ok=True)
for n in ['voice_studio','docs','audit','example_workspace','licenses']:shutil.copytree(P/n,app/n,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.part','*.openai-download-*','corresponding_source'))
for n in ['launch.py','LICENSE','README.md','THIRD_PARTY_NOTICES.md']:
 if (P/n).exists():shutil.copy2(P/n,app/n)
(app/'wheel_manifest.json').write_text(json.dumps(inventory,indent=2));(app/'runtime_manifest.json').write_text(json.dumps({'embedded_python':archive.name,'sha256':hashlib.file_digest(archive.open('rb'),'sha256').hexdigest(),'onnxruntime_included':False,'runtime_model_downloads':False,'node_runtime':False,'browser_server':False,'F5_patch':'Unused training Trainer import omitted; inference weights unchanged.'},indent=2));print('Private Windows runtime assembled',flush=True)

import runpy
runpy.run_path(str(P/'build/update_bundle.py'))
