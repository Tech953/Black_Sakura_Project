"""Extract the verified ZIP64 payload stored inside the single Setup.exe."""
from pathlib import Path,PurePosixPath
import hashlib,json,os,shutil,stat,sys,uuid,zipfile
EXPECTED_MANIFEST_SHA256='__PAYLOAD_MANIFEST_SHA256__'
def install(installer,destination):
    destination=Path(destination).resolve()
    if destination==Path(destination.anchor):raise ValueError('Choose a program folder, not a drive root.')
    parent=destination.parent;parent.mkdir(parents=True,exist_ok=True)
    if destination.exists() and any(destination.iterdir()) and not (destination/'app/voice_studio').is_dir():raise ValueError('Choose an empty folder or a recognized FULL_REZZ installation.')
    with zipfile.ZipFile(installer) as archive:
        raw=archive.read('FULL_REZZ_PAYLOAD_MANIFEST.json')
        if hashlib.sha256(raw).hexdigest()!=EXPECTED_MANIFEST_SHA256:raise ValueError('Internal payload manifest checksum failed.')
        manifest=json.loads(raw);entries=manifest['files'];expected={v['path']:v for v in entries};names=[i.filename for i in archive.infolist()]
        if len(expected)!=len(entries) or len(names)!=len(set(names)) or set(names)!=(set(expected)|{'FULL_REZZ_PAYLOAD_MANIFEST.json'}):raise ValueError('Installer member list is invalid.')
        if shutil.disk_usage(parent).free<sum(v['bytes'] for v in entries)+512*1024**2:raise ValueError('Insufficient free disk space.')
        stage=parent/(destination.name+'.install-'+uuid.uuid4().hex);stage.mkdir();backup=None
        try:
            for i,entry in enumerate(entries):
                name=entry['path'];parts=PurePosixPath(name).parts
                if not parts or name.startswith('/') or '\\' in name or ':' in name or any(p in ('.','..') for p in parts):raise ValueError('Unsafe installer path.')
                info=archive.getinfo(name)
                if stat.S_ISLNK(info.external_attr>>16) or info.file_size!=entry['bytes']:raise ValueError('Invalid member type or size.')
                target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);h=hashlib.sha256();size=0
                with archive.open(name) as source,target.open('wb') as out:
                    while block:=source.read(1024**2):h.update(block);size+=len(block);out.write(block)
                    out.flush();os.fsync(out.fileno())
                if size!=entry['bytes'] or h.hexdigest()!=entry['sha256']:raise ValueError('Installed file checksum failed: '+name)
                if i%1000==0:print('Verified',i,'of',len(entries),flush=True)
            (stage/'FULL_REZZ_PAYLOAD_MANIFEST.json').write_bytes(raw)
            if destination.exists():backup=parent/(destination.name+'.previous-'+uuid.uuid4().hex[:12]);os.replace(destination,backup)
            try:os.replace(stage,destination)
            except Exception:
                if backup:os.replace(backup,destination)
                raise
            print(json.dumps({'installed':True,'version':'3.0.0','files_verified':len(entries),'previous_installation_retained':str(backup) if backup else None,'workspace_files_modified':False}),flush=True)
        finally:
            if stage.exists():shutil.rmtree(stage)
if __name__=='__main__':
    try:install(sys.argv[1],sys.argv[2])
    except Exception as exc:print(str(exc),file=sys.stderr);raise SystemExit(1)
