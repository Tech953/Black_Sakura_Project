from pathlib import Path
import subprocess,urllib.request,zipfile,json,hashlib,concurrent.futures,shutil,shlex,sys
ROOT=Path(__file__).resolve().parent
def run(args,log):
 with (ROOT/log).open('w') as out:subprocess.run(args,stdout=out,stderr=subprocess.STDOUT,check=True)
def toolchain():
 result=subprocess.check_output(['apt-get','--print-uris','download','nsis','nsis-common','gcc-mingw-w64-x86-64-posix','gcc-mingw-w64-base','gcc-mingw-w64-x86-64-posix-runtime','binutils-mingw-w64-x86-64','mingw-w64-common','mingw-w64-x86-64-dev','7zip'],text=True);dest=ROOT/'toolchain';dest.mkdir(exist_ok=True)
 def fetch(line):
  if not line.startswith("'"):return
  url,name=shlex.split(line)[:2];target=dest/name
  with urllib.request.urlopen(url,timeout=90) as inp,target.open('wb') as out:shutil.copyfileobj(inp,out)
  subprocess.run(['dpkg-deb','-x',str(target),str(dest)],check=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,result.splitlines()))
 print('Toolchain prepared',flush=True)
def vendor():
 dest=ROOT/'vendor_wheels';dest.mkdir(exist_ok=True);run(['/tmp/full-rezz-env/bin/pip','download','--no-deps','-d',str(dest),'f5-tts==1.1.22','vocos==0.1.0'],'vendor_download.log');app=ROOT.parent/'FULL_REZZ/app';(app/'licenses').mkdir(exist_ok=True)
 for pattern,package in [('f5_tts*.whl','f5_tts'),('vocos*.whl','vocos')]:
  with zipfile.ZipFile(next(dest.glob(pattern))) as z:
   for name in z.namelist():
    if ((package=='f5_tts' and (name.startswith('f5_tts/model/') or name=='f5_tts/__init__.py')) or (package=='vocos' and name.startswith('vocos/'))) and 'trainer.py' not in name:z.extract(name,app)
    if 'LICENSE' in name:
     p=app/'licenses'/f'{package}_{Path(name).name}';p.parent.mkdir(exist_ok=True);p.write_bytes(z.read(name))
    if name.endswith('F5TTS_v1_Base.yaml'):(app/'licenses/F5TTS_v1_Base.upstream.yaml').write_bytes(z.read(name))
 (app/'f5_tts/model/__init__.py').write_text('from f5_tts.model.backbones.dit import DiT\nfrom f5_tts.model.cfm import CFM\n__all__=["CFM","DiT"]\n')
 p=app/'f5_tts/model/utils.py';p.write_text(p.read_text().replace('import rjieba','import jieba as rjieba'))
 p=app/'f5_tts/model/modules.py';s=p.read_text().replace('from librosa.filters import mel as librosa_mel_fn\n','');p.write_text(s.replace('    device = waveform.device','    from librosa.filters import mel as librosa_mel_fn\n    device = waveform.device',1))
 p=app/'vocos/feature_extractors.py';s=p.read_text().replace('from encodec import EncodecModel\n','');p.write_text(s.replace('        if encodec_model == "encodec_24khz":','        from encodec import EncodecModel\n        if encodec_model == "encodec_24khz":'))
 p=app/'vocos/pretrained.py';s=p.read_text();a=s.index('        config_path = hf_hub_download');b=s.index('    @torch.inference_mode()',a);s=s[:a]+'        raise RuntimeError("Use the bundled local Vocos weights.")\n\n'+s[b:];p.write_text(s.replace('from huggingface_hub import hf_hub_download\n',''))
 print('Inference vendor prepared',flush=True)
def windows():
 dest=ROOT/'win_wheels';dest.mkdir(exist_ok=True);run(['/tmp/full-rezz-env/bin/pip','wheel','--no-deps','-w',str(dest),'jieba==0.42.1'],'jieba_build.log')
 deps=['numpy==2.2.6','scipy==1.16.3','av==16.0.1','pypdf==6.1.1','torch==2.8.0+cpu','torchaudio==2.8.0+cpu','speechbrain==1.1.0','faster-whisper==1.2.1','PySide6==6.9.3','safetensors==0.6.2','einops==0.8.1','einx==0.3.0','x-transformers==1.44.8','torchdiffeq==0.2.5','jieba==0.42.1','pypinyin==0.55.0','setuptools==80.9.0']
 run(['/tmp/full-rezz-env/bin/pip','download','--disable-pip-version-check','--dest',str(dest),'--find-links',str(dest),'--platform','win_amd64','--python-version','3.13','--implementation','cp','--abi','cp313','--only-binary=:all:','--extra-index-url','https://download.pytorch.org/whl/cpu',*deps],'windows_download.log')
 runtime=ROOT/'windows_bundle/runtime';runtime.mkdir(parents=True,exist_ok=True);embed=ROOT/'python-3.13.12-embed-amd64.zip'
 with urllib.request.urlopen('https://www.python.org/ftp/python/3.13.12/python-3.13.12-embed-amd64.zip',timeout=90) as inp,embed.open('wb') as out:shutil.copyfileobj(inp,out)
 with zipfile.ZipFile(embed) as z:z.extractall(runtime)
 site=runtime/'Lib/site-packages';site.mkdir(parents=True,exist_ok=True)
 for file in sorted(dest.glob('*.whl')):
  if file.name.startswith('onnxruntime-'):continue
  with zipfile.ZipFile(file) as z:
   for info in z.infolist():
    parts=Path(info.filename).parts
    if not parts or info.is_dir():continue
    if parts[0].endswith('.data'):
     if len(parts)>2 and parts[1] in ('purelib','platlib'):target=site/Path(*parts[2:])
     else:continue
    else:target=site/info.filename
    if target.suffix.lower() in ('.lib','.pdb','.a') or ('torch' in target.parts and 'include' in target.parts) or ('silero_vad' in target.name and target.suffix=='.onnx'):continue
    target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(z.read(info))
 for name in ['msvcp140.dll','msvcp140_1.dll','msvcp140_2.dll','vcruntime140.dll','vcruntime140_1.dll','concrt140.dll']:
  candidates=list((site/'shiboken6').rglob(name))
  if candidates:shutil.copy2(candidates[0],runtime/name)
 (runtime/'python313._pth').write_text('python313.zip\n.\nLib\\site-packages\n..\\app\nimport site\n');files=[embed,*[p for p in dest.glob('*.whl') if not p.name.startswith('onnxruntime-')]]
 (ROOT/'runtime_manifest.json').write_text(json.dumps({'python_version':'3.13.12','platform':'Windows x64','archives':[{'filename':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'size_bytes':p.stat().st_size} for p in files]},indent=2)+'\n');run([sys.executable,str(ROOT/'prune_runtime.py')],'runtime_pruning.log');print('Windows runtime prepared',flush=True)
if __name__=='__main__':{'toolchain':toolchain,'vendor':vendor,'windows':windows}[sys.argv[1]]()
