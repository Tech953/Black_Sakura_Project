"""Download signed Ubuntu build tools into a private directory, without system installation."""
from pathlib import Path
import urllib.request, subprocess, hashlib, lzma, json, concurrent.futures
ROOT=Path(__file__).resolve().parent
BASE='https://snapshot.ubuntu.com/ubuntu/20260828T000000Z/'
WANTED={'nsis','nsis-common','gcc-mingw-w64-x86-64-posix','gcc-mingw-w64-base','gcc-mingw-w64-x86-64-posix-runtime','binutils-mingw-w64-x86-64','mingw-w64-common','mingw-w64-x86-64-dev','7zip'}
def get(url):
 with urllib.request.urlopen(url,timeout=120) as r:return r.read()
dest=ROOT/'toolchain';dest.mkdir(exist_ok=True)
release=get(BASE+'dists/noble/InRelease');(dest/'InRelease').write_bytes(release)
subprocess.run(['gpgv','--keyring','/usr/share/keyrings/ubuntu-archive-keyring.gpg',str(dest/'InRelease')],check=True)
found={}
for component in ['main','universe']:
 rel=f'{component}/binary-amd64/Packages.xz';entry=next(line.split() for line in release.decode().splitlines() if line.strip().endswith(' '+rel) and len(line.split()[0])==64)
 data=get(BASE+'dists/noble/'+rel);assert hashlib.sha256(data).hexdigest()==entry[0]
 for paragraph in lzma.decompress(data).decode().split('\n\n'):
  fields={line.split(': ',1)[0]:line.split(': ',1)[1] for line in paragraph.splitlines() if ': ' in line and not line.startswith(' ')}
  if fields.get('Package') in WANTED:found[fields['Package']]=fields
assert set(found)==WANTED,WANTED-set(found)
def fetch(fields):
 data=get(BASE+fields['Filename']);assert hashlib.sha256(data).hexdigest()==fields['SHA256'];p=dest/Path(fields['Filename']).name;p.write_bytes(data)
 subprocess.run(['dpkg-deb','-x',str(p),str(dest)],check=True)
 print(fields['Package'],fields['Version'],len(data),flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(fetch,found.values()))
(ROOT/'toolchain_manifest.json').write_text(json.dumps({k:{f:v for f,v in info.items() if f in ('Version','Filename','SHA256','Size')} for k,info in found.items()},indent=2)+'\n')
