"""Build-only acquisition; require every retained font/license hash to match."""
from pathlib import Path
import json,urllib.request,hashlib,os,uuid
root=Path(__file__).resolve().parents[1]/'fonts'
for a in json.loads((root/'manifest.json').read_text())['assets']:
 p=root/a['path']
 if p.exists() and p.stat().st_size==a['bytes'] and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==a['sha256']:continue
 temp=p.with_name(p.name+'.part-'+uuid.uuid4().hex)
 with urllib.request.urlopen(a['source']) as src,temp.open('wb') as dst:
  while b:=src.read(1024*1024):dst.write(b)
  dst.flush();os.fsync(dst.fileno())
 if temp.stat().st_size!=a['bytes'] or hashlib.file_digest(temp.open('rb'),'sha256').hexdigest()!=a['sha256']:temp.unlink();raise ValueError('Upstream font changed; do not silently update provenance')
 os.replace(temp,p)
print('Bundled font and full license hashes verified')
