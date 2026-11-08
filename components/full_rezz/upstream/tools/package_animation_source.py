"""Package complete current/legacy authored source with checksums; omit raw buffers."""
import hashlib,json,os,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]).resolve();target=Path(sys.argv[2]).resolve()
def files():
    return sorted(p for p in root.rglob('*') if p.is_file() and not any(x in {'frames','node_modules','__pycache__'} or x.startswith('.') for x in p.relative_to(root).parts)
        and p.suffix not in {'.pyc','.zip'} and not p.name.endswith('.staged') and not p.name.startswith('full_resolution'))
paths=[p for p in files() if p.name!='CHECKSUMS.sha256']
hashes={p.relative_to(root).as_posix():hashlib.file_digest(p.open('rb'),'sha256').hexdigest() for p in paths}
(root/'CHECKSUMS.sha256').write_text(''.join(value+'  '+key+'\n' for key,value in sorted(hashes.items())))
target.parent.mkdir(parents=True,exist_ok=True);stage=target.with_suffix('.staged')
with zipfile.ZipFile(stage,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in files():archive.write(path,root.name+'/'+path.relative_to(root).as_posix())
with zipfile.ZipFile(stage) as archive:
    assert archive.testzip() is None
    for name,expected in hashes.items():assert hashlib.sha256(archive.read(root.name+'/'+name)).hexdigest()==expected
with stage.open('rb') as stream:os.fsync(stream.fileno())
os.replace(stage,target)
print(json.dumps({'name':target.name,'bytes':target.stat().st_size,'sha256':hashlib.file_digest(target.open('rb'),'sha256').hexdigest(),'files':len(files()),'all_hashes_and_crc_verified':True}))
