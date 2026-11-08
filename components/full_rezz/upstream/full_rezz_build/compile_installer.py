"""Compile in a private temporary directory, then stream-publish a complete installer."""
from pathlib import Path
import tempfile,subprocess,shutil,os,json,hashlib
ROOT=Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='full-rezz-nsis-') as temp:
 base=Path(temp);payload=base/'windows_bundle';payload.mkdir();manifest=json.loads((ROOT/'windows_bundle/bundle_manifest.json').read_text())
 for relative in [e['path'] for e in manifest['files']]+['bundle_manifest.json','BUNDLE_CHECKSUMS.sha256']:
  target=payload/relative;target.parent.mkdir(parents=True,exist_ok=True);os.link(ROOT/'windows_bundle'/relative,target)
 with (ROOT/'pe_check.log').open('w') as log:subprocess.run(['python3',str(ROOT/'check_pe_dependencies.py'),str(payload)],stdout=log,stderr=subprocess.STDOUT,check=True)
 (ROOT/'compiled_payload_manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
 for name in ('installer.nsi','payload_files.nsh','uninstall_files.nsh'):shutil.copy2(ROOT/name,base/name)
 env=os.environ.copy();env['NSISDIR']=str(ROOT/'toolchain/usr/share/nsis');env['TMPDIR']=str(base)
 with (ROOT/'installer_build.log').open('w') as log:subprocess.run([str(ROOT/'toolchain/usr/bin/makensis'),'-V3','installer.nsi'],cwd=base,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
 source=base/'FULL_REZZ_2.0_Offline_Setup.exe';target=ROOT/source.name;stage=target.with_suffix('.staged');h=hashlib.sha256()
 with source.open('rb') as inp,stage.open('wb') as out:
  while data:=inp.read(4*1024**2):h.update(data);out.write(data)
  out.flush();os.fsync(out.fileno())
 assert stage.stat().st_size==source.stat().st_size;os.replace(stage,target)
 print(json.dumps({'bytes':target.stat().st_size,'sha256':h.hexdigest(),'temporary_compile_directory':True}),flush=True)
