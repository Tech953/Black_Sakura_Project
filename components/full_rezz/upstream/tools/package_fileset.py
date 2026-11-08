"""Make a checked Replit source ZIP and a separate complete source release."""
from pathlib import Path
import hashlib,json,os,zipfile,argparse
ROOT=Path(__file__).resolve().parents[1]
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def common(p):
 rel=p.relative_to(ROOT);parts=rel.parts
 return p.is_file() and '__pycache__' not in parts and 'toolchain' not in parts and 'models' not in parts and p.suffix!='.pyc' and '.partial.' not in p.name and not p.name.endswith('.staged') and p.name!='FILESET_CHECKSUMS.sha256' and not any(v.startswith('.') for v in parts if v not in ('.replit','.gitignore'))
def replit(p):
 rel=p.relative_to(ROOT).as_posix();parts=p.relative_to(ROOT).parts
 return common(p) and 'corresponding_source' not in parts and 'prior_rebecca_evidence' not in parts and 'prior_release_2.0' not in parts and not rel.startswith('docs/prior_voice3_documents/') and not (rel.startswith('FULL_REZZ/app/examples/') and p.suffix not in ('.json','.py','.md','.txt')) and rel not in ('animation/Rebecca_Full_Action_Source.zip','animation/Rebecca_Full_Action_Player.html','FULL_REZZ/app/static/Rebecca_60fps_Player.html')
def package(target,predicate):
 files=sorted(p for p in ROOT.rglob('*') if predicate(p));hashes={p.relative_to(ROOT).as_posix():digest(p) for p in files};stage=target.with_suffix('.staged')
 with zipfile.ZipFile(stage,'w',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
  for p in files:z.write(p,'FULL_REZZ_Replit/'+p.relative_to(ROOT).as_posix())
  z.writestr('FULL_REZZ_Replit/FILESET_CHECKSUMS.sha256',''.join(sha+'  '+name+'\n' for name,sha in hashes.items()))
 with zipfile.ZipFile(stage) as z:
  if z.testzip() is not None:raise ValueError('Source ZIP CRC failure')
  for name,sha in hashes.items():
   with z.open('FULL_REZZ_Replit/'+name) as f:
    if hashlib.file_digest(f,'sha256').hexdigest()!=sha:raise ValueError('Source ZIP hash failure: '+name)
 os.replace(stage,target)
 return {'fileset':target.name,'program_version':'3.0.0','delivery_revision':'2026-10-14.2','bytes':target.stat().st_size,'sha256':digest(target),'entries':len(files)+1,'all_entry_hashes_and_crc_verified':True,'model_weights_and_private_windows_runtime_in_zip':False,'signed_in_replit_execution_tested':False,'native_windows_execution_tested':False,'host_engram_repository_modified':False}
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output-dir',default=str(ROOT.parent));args=parser.parse_args();out=Path(args.output_dir);out.mkdir(parents=True,exist_ok=True)
 target=out/'FULL_REZZ_Replit_Engram_Fileset.zip';r=package(target,replit)
 if target.stat().st_size>=200_000_000:raise ValueError('Replit ZIP exceeds 200 MB; inspect explicit exclusions.')
 r['below_200_MB_import_limit']=True;r['corresponding_source_archives_included']=False;(out/'FULL_REZZ_Replit_Fileset_Verification.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2),flush=True)
 r=package(out/'FULL_REZZ_3.0_Source.zip',common);r['corresponding_source_archives_included']=True;(out/'FULL_REZZ_3.0_Source_Verification.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r,indent=2),flush=True)
if __name__=='__main__':main()
