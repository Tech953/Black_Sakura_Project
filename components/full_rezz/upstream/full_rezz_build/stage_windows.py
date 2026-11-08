"""Stage complete self-contained files and a manifest; omit only build/test caches."""
from pathlib import Path
import shutil,os,hashlib,json,subprocess,base64,zipfile
ROOT=Path(__file__).resolve().parents[1];BUILD=ROOT/'full_rezz_build';APP=ROOT/'FULL_REZZ/app';BUNDLE=BUILD/'windows_bundle'
# Headers are for compiling extensions; this application uses prebuilt CPU inference.
shutil.rmtree(BUNDLE/'runtime/Lib/site-packages/torch/include',ignore_errors=True)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(4*1024**2):h.update(b)
 return h.hexdigest()
(APP/'examples').mkdir(exist_ok=True);shutil.copy2(ROOT/'upload/Rebecca_Audited_Voice_Profile.zip',APP/'examples/Rebecca_Reference.zip')
project=ROOT/'Rebecca_2D_60fps';html=(project/'Rebecca_Full_Action_Player.html').read_text()
for key,path in [('refined',project/'exports/Rebecca_Full_Voiced_Action.mp4'),('before',project/'audit/before/movie.mp4')]:
 target=BUILD/(key+'.webm')
 if not target.exists() or target.stat().st_mtime<path.stat().st_mtime:subprocess.run(['ffmpeg','-v','error','-y','-i',str(path),'-c:v','libvpx-vp9','-b:v','0','-crf','24','-row-mt','1','-cpu-used','4','-c:a','libopus',str(target)],check=True)
 probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-show_streams','-of','json',str(target)]));stream=next(x for x in probe['streams'] if x['codec_type']=='video');assert int(stream['nb_read_frames'])==(720 if key=='refined' else 288)
 html=html.replace('data:video/mp4;base64,'+base64.b64encode(path.read_bytes()).decode(),'data:video/webm;base64,'+base64.b64encode(target.read_bytes()).decode())
(APP/'examples/Rebecca_60fps_Player.html').write_text(html)
(APP/'audit-artifacts/webm-playback.json').write_text(json.dumps({'video_codec':'VP9','audio_codec':'Opus','refined_frames':720,'refined_fps':60,'baseline_frames':288,'baseline_fps':24,'native_qt_playback_tested':False},indent=2)+'\n')
for name in ['render_validation.json','export_validation.json','player_validation.json']:
 shutil.copy2(project/name,APP/'audit-artifacts'/('animation_'+name))
shutil.copy2(project/'audit/quality_audit.json',APP/'audit-artifacts/animation_quality_audit.json')
# Preserve upstream cards/licenses; no bundled package binary is modified.
(APP/'licenses/runtime').mkdir(parents=True,exist_ok=True)
for file in (BUILD/'windows_bundle/runtime/Lib/site-packages').glob('*.dist-info/*'):
 if file.is_file() and file.name.lower().startswith(('license','copying','notice')):shutil.copy2(file,APP/'licenses/runtime'/(file.parent.name+'_'+file.name))
shutil.copy2(BUILD/'runtime_manifest.json',APP/'audit-artifacts/runtime_manifest.json');shutil.copy2(BUILD/'toolchain_manifest.json',APP/'audit-artifacts/toolchain_manifest.json')
if (BUILD/'runtime_pruning.json').exists():shutil.copy2(BUILD/'runtime_pruning.json',APP/'audit-artifacts/runtime_pruning.json')
for group in ['f5','whisper','ecapa','sepformer','vocos']:
 shutil.copy2(APP/'bundled_models'/group/'README.md',APP/'licenses'/(group+'_model_card.md'))
allowed={x['path'] for x in json.loads((APP/'bundled_models/manifest.json').read_text())['files']}|{'manifest.json'}
for p in (APP/'bundled_models').rglob('*'):
 if p.is_file() and p.relative_to(APP/'bundled_models').as_posix() not in allowed:p.unlink()
stage=BUNDLE/'app'
if stage.exists():shutil.rmtree(stage)
def ignore(directory,names):return [x for x in names if x in ('__pycache__','model_cache','.pytest_cache') or x.endswith('.pyc')]
shutil.copytree(APP,stage,copy_function=os.link,ignore=ignore)
pruned={e['path'] for e in json.loads((BUILD/'runtime_pruning.json').read_text())['removed_files']} if (BUILD/'runtime_pruning.json').exists() else set()
entries=[{'path':p.relative_to(BUNDLE).as_posix(),'size_bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(BUNDLE.rglob('*')) if p.is_file() and p.name not in ('bundle_manifest.json','BUNDLE_CHECKSUMS.sha256') and p.relative_to(BUNDLE).as_posix() not in pruned]
(BUNDLE/'bundle_manifest.json').write_text(json.dumps({'program':'FULL_REZZ','version':'2.0.0','files':entries,'native_windows_execution_tested':False},indent=2)+'\n');(BUNDLE/'BUNDLE_CHECKSUMS.sha256').write_text(''.join(e['sha256']+'  '+e['path']+'\n' for e in entries))
def nsis(s):return s.replace('$','$$').replace('"','$\\"')
with (BUILD/'payload_files.nsh').open('w') as out:
 for relative in [e['path'] for e in entries]+['bundle_manifest.json','BUNDLE_CHECKSUMS.sha256']:
  p=Path(relative);folder=str(p.parent).replace('/','\\')
  out.write('SetOutPath "$INSTDIR'+('\\'+nsis(folder) if folder!='.' else '')+'"\n')
  out.write('File "/oname='+nsis(p.name)+'" "windows_bundle/'+nsis(relative)+'"\n')
with (BUILD/'uninstall_files.nsh').open('w') as out:
 directories=set()
 for relative in [e['path'] for e in entries]+['bundle_manifest.json','BUNDLE_CHECKSUMS.sha256']:
  p=Path(relative);out.write('Delete "$INSTDIR\\'+nsis(str(p).replace('/','\\'))+'"\n');directories.update(x for x in p.parents if str(x)!='.')
 for p in sorted(directories,key=lambda p:len(p.parts),reverse=True):out.write('RMDir "$INSTDIR\\'+nsis(str(p).replace('/','\\'))+'"\n')
print(json.dumps({'files':len(entries),'bytes':sum(x['size_bytes'] for x in entries),'models_included':True}))
