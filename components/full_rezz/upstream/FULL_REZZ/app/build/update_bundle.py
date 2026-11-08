"""Stage application files and atomically copy verified full model assets."""
from pathlib import Path
import shutil, json, hashlib, os, uuid
root = Path(__file__).resolve().parents[1]
app = root/'build/package/app'
app.mkdir(parents=True, exist_ok=True)
for name in ['voice_studio','docs','audit','example_workspace','licenses','fonts','vendor']:
    if (app/name).exists(): shutil.rmtree(app/name)
    shutil.copytree(root/name, app/name, dirs_exist_ok=True,
        ignore=shutil.ignore_patterns('__pycache__','*.pyc','*.part','*.openai-download-*','corresponding_source','prior_release_2.0'))
for name in ['README.md','THIRD_PARTY_NOTICES.md','LICENSE','launch.py']:
    shutil.copy2(root/name, app/name)
manifest = json.loads((root/'models/manifest.json').read_text())
for asset in manifest['assets']:
    src = root/'models'/asset['path']; dst = app/'models'/asset['path']
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size == asset['bytes'] and hashlib.file_digest(dst.open('rb'),'sha256').hexdigest() == asset['sha256']:
        continue
    temporary = dst.with_name(dst.name+'.copy-'+uuid.uuid4().hex)
    digest=hashlib.sha256(); size=0
    try:
        with src.open('rb') as incoming, temporary.open('wb') as outgoing:
            while block:=incoming.read(1024*1024):
                outgoing.write(block);digest.update(block);size+=len(block)
            outgoing.flush();os.fsync(outgoing.fileno())
        if size != asset['bytes'] or digest.hexdigest() != asset['sha256']:
            raise RuntimeError('Model copy verification failed: '+asset['path'])
        os.replace(temporary,dst)
    finally:
        temporary.unlink(missing_ok=True)
for group in ['fonts','vendor/espeak-ng']:
    for asset in json.loads((root/group/'manifest.json').read_text())['assets']:
        dst=app/group/asset['path']
        if dst.stat().st_size!=asset['bytes'] or hashlib.file_digest(dst.open('rb'),'sha256').hexdigest()!=asset['sha256']:
            raise RuntimeError('Resource copy verification failed: '+group+'/'+asset['path'])
(app/'models/manifest.json').write_text(json.dumps(manifest,indent=2))
print('Application and all model copies verified',flush=True)
