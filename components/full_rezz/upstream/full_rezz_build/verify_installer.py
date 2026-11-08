"""Extract and hash every installed payload byte without executing Windows code."""
from pathlib import Path
import json,hashlib,subprocess,os,shutil
ROOT=Path(__file__).resolve().parents[1];BUILD=ROOT/'full_rezz_build';INSTALLER=BUILD/'FULL_REZZ_2.0_Offline_Setup.exe';DEST=BUILD/'installer_extracted';TOOL=BUILD/'toolchain/usr/lib/7zip/7z'
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(4*1024**2):h.update(b)
 return h.hexdigest()
if DEST.exists():shutil.rmtree(DEST)
with (BUILD/'installer_extract.log').open('w') as log:subprocess.run([str(TOOL),'x','-y','-o'+str(DEST),str(INSTALLER)],stdout=log,stderr=subprocess.STDOUT,check=True)
manifest=json.loads((BUILD/'compiled_payload_manifest.json').read_text());largest=max(manifest['files'],key=lambda x:x['size_bytes']);target=DEST/largest['path'];stage=target.with_suffix('.verified');h=hashlib.sha256();size=0
with (BUILD/'largest_model_extract.log').open('wb') as log,stage.open('wb') as out:
 process=subprocess.Popen([str(TOOL),'x','-so','-bso0','-bsp0',str(INSTALLER),largest['path']],stdout=subprocess.PIPE,stderr=log)
 while b:=process.stdout.read(4*1024**2):h.update(b);size+=len(b);out.write(b)
 assert process.wait()==0;out.flush();os.fsync(out.fileno())
assert size==largest['size_bytes'] and h.hexdigest()==largest['sha256'];os.replace(stage,target)
for i,e in enumerate(manifest['files']):
 p=DEST/e['path'];assert p.is_file() and p.stat().st_size==e['size_bytes'] and digest(p)==e['sha256'],e['path']
 if i%5000==0:print('Verified',i,flush=True)
assert json.loads((DEST/'bundle_manifest.json').read_text())==manifest
assert (DEST/'BUNDLE_CHECKSUMS.sha256').read_text()==''.join(e['sha256']+'  '+e['path']+'\n' for e in manifest['files'])
report={'program':'FULL_REZZ','version':'2.0.0','installer_filename':INSTALLER.name,'installer_sha256':digest(INSTALLER),'installer_bytes':INSTALLER.stat().st_size,'payload_files_checked':len(manifest['files']),'payload_bytes_checked':sum(e['size_bytes'] for e in manifest['files']),'all_payload_sizes_and_sha256_match':True,'largest_model_streamed_and_fsynced':True,'windows_native_execution_tested':False,'human_listening_review_performed':False,'unsigned':True,'method':'Independent 7-Zip NSIS extraction plus every-file size/SHA256 comparison; large F5 payload separately streamed, hashed and fsynced.'}
(ROOT/'FULL_REZZ_Installer_Verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
