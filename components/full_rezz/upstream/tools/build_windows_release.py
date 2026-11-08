"""Build a small NSIS wizard with a complete internally appended ZIP64 payload."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
DELIVERY_REVISION='2026-10-14.2'
def digest(path):
    with Path(path).open('rb') as file:return hashlib.file_digest(file,'sha256').hexdigest()
def quote(value):return str(value).replace('$','$$').replace('"','$\\"')
def copy(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists():target.unlink()
    shutil.copy2(source,target)
def main():
    p=argparse.ArgumentParser()
    for n in ['base-payload','models','toolchain','work','output','embed-zip','opengl-wheel','multimedia-overlay']:p.add_argument('--'+n,required=True)
    a=p.parse_args();base=Path(a.base_payload);work=Path(a.work);output=Path(a.output);tc=Path(a.toolchain);models=Path(a.models);work.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True);payload=work/'payload';payload.mkdir(exist_ok=True)
    if not (payload/'python').exists():shutil.copytree(base/'python',payload/'python',copy_function=os.link)
    site=payload/'python/Lib/site-packages'
    with zipfile.ZipFile(a.opengl_wheel) as wheel:
        for i in wheel.infolist():
            if i.is_dir():continue
            target=site/i.filename;target.parent.mkdir(parents=True,exist_ok=True)
            if target.exists():target.unlink()
            target.write_bytes(wheel.read(i))
    for source in Path(a.multimedia_overlay).rglob('*'):
        if source.is_file():copy(source,site/source.relative_to(a.multimedia_overlay))
    app=payload/'app'
    if app.exists():shutil.rmtree(app)
    shutil.copytree(ROOT/'FULL_REZZ/app',app,ignore=shutil.ignore_patterns('__pycache__','*.pyc','build','tests','models','corresponding_source','prior_release_2.0','prior_rebecca_evidence','legacy_test_sources','legacy_http_tests','prior_voice3_documents'))
    manifest=json.loads((models/'manifest.json').read_text())
    for entry in manifest['assets']:
        source=models/entry['path'];target=app/'models'/entry['path'];target.parent.mkdir(parents=True,exist_ok=True)
        if source.stat().st_size!=entry['bytes'] or digest(source)!=entry['sha256']:raise ValueError('Model hash changed: '+entry['path'])
        os.link(source,target)
    copy(models/'manifest.json',app/'models/manifest.json')
    subprocess.run([str(tc/'usr/bin/x86_64-w64-mingw32-gcc-posix'),'-municode','-mwindows','-Os','-s',str(ROOT/'tools/windows_launcher.c'),'-o',str(payload/'FULL_REZZ.exe')],check=True)
    files=[{'path':p.relative_to(payload).as_posix(),'bytes':p.stat().st_size,'sha256':digest(p)} for p in sorted(payload.rglob('*')) if p.is_file() and '__pycache__' not in p.parts and p.suffix!='.pyc']
    raw=(json.dumps({'program':'FULL_REZZ','version':'3.0.0','delivery_revision':DELIVERY_REVISION,'files':files,'total_bytes':sum(x['bytes'] for x in files),'model_assets':len(manifest['assets']),'native_windows_execution_tested':False},indent=2)+'\n').encode();sha=hashlib.sha256(raw).hexdigest();(work/'payload-manifest.json').write_bytes(raw)
    bootstrap=work/'bootstrap';bootstrap.mkdir(exist_ok=True)
    with zipfile.ZipFile(a.embed_zip) as z:z.extractall(bootstrap)
    (bootstrap/'python311._pth').write_text('python311.zip\n.\nimport site\n');(bootstrap/'install_payload.py').write_text((ROOT/'tools/installer_payload.py').read_text().replace('__PAYLOAD_MANIFEST_SHA256__',sha))
    with (work/'bootstrap_files.nsh').open('w') as f:
        for p in sorted(bootstrap.iterdir()):
            if p.is_file():f.write('File "/oname='+quote(p.name)+'" "'+quote(p)+'"\n')
    directories=set()
    with (work/'uninstall_files.nsh').open('w') as f:
        for entry in files+[{'path':'FULL_REZZ_PAYLOAD_MANIFEST.json'}]:
            path=Path(entry['path']);f.write('Delete "$INSTDIR\\'+quote(str(path).replace('/','\\'))+'"\n');directories.update(d for d in path.parents if str(d)!='.')
        for d in sorted(directories,key=lambda p:len(p.parts),reverse=True):f.write('RMDir "$INSTDIR\\'+quote(str(d).replace('/','\\'))+'"\n')
    languages=['English','Spanish','French','German','Portuguese','Italian','Russian','Japanese','Korean','SimpChinese','Arabic','Hindi']
    script=(ROOT/'tools/installer_bootstrap.nsi').read_text().replace('__LANGUAGE_MACROS__',''.join('!insertmacro MUI_LANGUAGE "'+v+'"\n' for v in languages));(work/'installer.nsi').write_text(script);env=os.environ.copy();env['NSISDIR']=str(tc/'usr/share/nsis');subprocess.run([str(tc/'usr/bin/makensis'),'-V2','installer.nsi'],cwd=work,env=env,check=True)
    installer=output/'FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe';shutil.copy2(work/'FULL_REZZ_3.0_Bootstrap.exe',installer)
    with zipfile.ZipFile(installer,'a',zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
        for entry in files:z.write(payload/entry['path'],entry['path'])
        z.writestr('FULL_REZZ_PAYLOAD_MANIFEST.json',raw)
    with zipfile.ZipFile(installer) as z:
        if z.testzip() is not None:raise ValueError('Final payload CRC failed.')
        for entry in files:
            h=hashlib.sha256();size=0
            with z.open(entry['path']) as f:
                while block:=f.read(1024**2):h.update(block);size+=len(block)
            if h.hexdigest()!=entry['sha256'] or size!=entry['bytes']:raise ValueError('Final payload hash mismatch: '+entry['path'])
    report={'program':'FULL_REZZ','version':'3.0.0','installer':installer.name,'bytes':installer.stat().st_size,'sha256':digest(installer),'payload_files_verified':len(files),'payload_bytes_verified':sum(x['bytes'] for x in files),'manifest_sha256':sha,'all_payload_crc_sizes_and_hashes_verified':True,'all_model_assets':len(manifest['assets']),'external_node_python_or_model_service_required':False,'native_windows_execution_tested':False,'unsigned':True,'format':'NSIS wizard and internally appended ZIP64 payload'}
    report['delivery_revision']=DELIVERY_REVISION
    (output/'FULL_REZZ_3.0_Installer_Verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)
if __name__=='__main__':main()
