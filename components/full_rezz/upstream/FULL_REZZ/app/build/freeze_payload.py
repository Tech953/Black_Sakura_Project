from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parent;bundle=root/'package';records=[]
for group in ['models','fonts','vendor/espeak-ng']:
 for a in json.loads((bundle/'app'/group/'manifest.json').read_text())['assets']:
  p=bundle/'app'/group/a['path']
  if p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']: raise RuntimeError('Invalid bundled asset: '+group+'/'+a['path'])
files=sorted(p for p in bundle.rglob('*') if p.is_file() and not any(x.startswith('.') or x=='__pycache__' for x in p.relative_to(bundle).parts) and p.suffix not in ('.pyc','.part') and 'corresponding_source' not in p.relative_to(bundle).parts and p.name!='payload_manifest.json' and '.openai-download-' not in p.name)
for p in files:records.append({'path':p.relative_to(bundle).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()})
man=bundle/'app/payload_manifest.json';man.write_text(json.dumps({'files':records,'total_bytes':sum(r['bytes'] for r in records),'count':len(records)},indent=2));files.append(man);files.sort();out=[];last=None;directories=set()
def esc(s):return str(s).replace('$','$$').replace('"','$\\"')
for p in files:
 relative=p.relative_to(bundle);folder=relative.parent.as_posix().replace('/','\\')
 if folder!=last:out.append('SetOutPath "$INSTDIR'+('\\'+esc(folder) if folder!='.' else '')+'"');last=folder
 out.append('File "'+esc(p.resolve())+'"')
 for parent in relative.parents:
  if str(parent)!='.':directories.add(parent.as_posix())
(root/'installer_files.nsh').write_text('\n'.join(out)+'\n');uninstall=['Delete "$INSTDIR\\'+esc(p.relative_to(bundle).as_posix().replace('/','\\'))+'"' for p in files];uninstall+=['RMDir "$INSTDIR\\'+esc(d.replace('/','\\'))+'"' for d in sorted(directories,key=lambda d:(d.count('/'),d),reverse=True)];(root/'uninstall_files.nsh').write_text('\n'.join(uninstall)+'\n');print(len(files),sum(p.stat().st_size for p in files),flush=True)
