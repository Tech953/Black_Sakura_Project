from pathlib import Path
import zipfile,hashlib,json,os,shutil
ROOT=Path(__file__).resolve().parents[1];APP=ROOT/'FULL_REZZ/app';BUILD=ROOT/'full_rezz_build'
target=ROOT/'FULL_REZZ_2.0_Source.zip';stage=target.with_suffix('.staged');entries={}
for p in APP.rglob('*'):
 if not p.is_file() or any(x in p.relative_to(APP).parts for x in ('bundled_models','__pycache__','model_cache')) or p.suffix in ('.pyc','.part'):continue
 entries['FULL_REZZ/app/'+p.relative_to(APP).as_posix()]=p
for p in BUILD.iterdir():
 if p.is_file() and (p.suffix in ('.py','.c','.nsi','.nsh') or p.name in ('runtime_manifest.json','runtime_pruning.json','compiled_payload_manifest.json','toolchain_manifest.json','pe_dependencies.json','requirements-windows-lock.txt','Assemble_Installer.cmd')):entries['full_rezz_build/'+p.name]=p
for name in ['FULL_REZZ_Audit.md','FULL_REZZ_User_Guide.pdf','FULL_REZZ_Quick_Start.pdf','FULL_REZZ_Installer_Verification.json','FULL_REZZ_Delivery_Manifest.json']:
 if (ROOT/name).is_file():entries['FULL_REZZ/'+name]=ROOT/name
entries['FULL_REZZ/app/model_asset_manifest.json']=APP/'bundled_models/manifest.json'
expected={name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in entries.items()}
with zipfile.ZipFile(stage,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for name,p in sorted(entries.items()):z.write(p,name)
 z.writestr('FULL_REZZ/SOURCE_CHECKSUMS.sha256',''.join(sha+'  '+name+'\n' for name,sha in sorted(expected.items())))
with zipfile.ZipFile(stage) as z:
 assert z.testzip() is None
 for name,sha in expected.items():assert hashlib.sha256(z.read(name)).hexdigest()==sha
with stage.open('rb') as f:os.fsync(f.fileno())
os.replace(stage,target);report={'filename':target.name,'bytes':target.stat().st_size,'files':len(expected)+1,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'all_entries_and_crc_verified':True,'weights_and_windows_runtime_included':False};(BUILD/'source_package_receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
