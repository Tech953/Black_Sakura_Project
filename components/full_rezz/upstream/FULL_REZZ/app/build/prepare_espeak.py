"""Build-only reconstruction of unmodified upstream MSI files."""
from pathlib import Path
import csv,json,hashlib,shutil,tarfile
root=Path(__file__).resolve().parents[1];download=root.parents[1]/'espeak-download';target=root/'vendor/espeak-ng';target.mkdir(parents=True,exist_ok=True)
def rows(name):
 with (download/(name+'.tsv')).open(encoding='utf-8-sig',newline='') as stream:return list(csv.DictReader(stream,delimiter='\t'))[2:]
dirs={r['Directory']:r for r in rows('Directory')};components={r['Component']:r for r in rows('Component')}
def folder(name):
 if name=='INSTALLDIR':return Path()
 r=dirs[name];leaf=r['DefaultDir'].split(':')[0].split('|')[-1].strip();return folder(r['Directory_Parent'])/(leaf if leaf!='.' else '')
assets=[]
for r in rows('File'):
 src=download/'msi'/r['File'];dst=target/folder(components[r['Component_']]['Directory_'])/r['FileName'].split('|')[-1].strip();dst.parent.mkdir(parents=True,exist_ok=True)
 if not dst.resolve().is_relative_to(target.resolve()):raise ValueError('MSI path escape')
 shutil.copyfile(src,dst);digest=hashlib.file_digest(src.open('rb'),'sha256').hexdigest()
 if dst.stat().st_size!=int(r['FileSize']) or hashlib.file_digest(dst.open('rb'),'sha256').hexdigest()!=digest:raise ValueError('Incomplete MSI copy')
 assets.append({'path':dst.relative_to(target).as_posix(),'bytes':dst.stat().st_size,'sha256':digest})
manifest={'engine':'eSpeak NG','version':'1.52.0','source':'https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0','license':'GPL-3.0-or-later','msi_sha256':hashlib.file_digest((download/'espeak-ng.msi').open('rb'),'sha256').hexdigest(),'assets':assets,'windows_execution_verified':False}
(target/'manifest.json').write_text(json.dumps(manifest,indent=2));(root/'audit/espeak_asset_manifest.json').write_text(json.dumps(manifest,indent=2))
shutil.copy2(download/'espeak-ng-1.52.0-source.tar.gz',root/'licenses/corresponding_source/espeak-ng-1.52.0-source.tar.gz')
with tarfile.open(download/'espeak-ng-1.52.0-source.tar.gz') as archive:
 file=next(m for m in archive.getmembers() if m.name.endswith('/COPYING'));(root/'licenses/eSpeak-NG-GPL-3.0.txt').write_bytes(archive.extractfile(file).read())
print(len(assets),'upstream portable speech assets verified',flush=True)
