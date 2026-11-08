"""Create checked delivery parts and auditable source/Replit archives.

Run only after check_installer.py has passed. No installed runtime downloads.
"""
from pathlib import Path
import argparse,hashlib,json,math,os,shutil,uuid,zipfile

def sha(path):
 with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def write(path,data):
 path.parent.mkdir(parents=True,exist_ok=True);temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
 with temporary.open('wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
 os.replace(temporary,path)

def json_write(path,data):write(path,(json.dumps(data,ensure_ascii=False,indent=2)+'\n').encode())

def archive(path,files):
 records=[{'path':name,'bytes':src.stat().st_size,'sha256':sha(src)} for name,src in files]
 manifest={'schema_version':'1.0.0','program_version':'3.0.0','files':records,'manifest_excludes_itself':True}
 temporary=path.with_name(path.name+'.building')
 with temporary.open('wb') as stream:
  with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
   for name,src in files:z.write(src,name)
   z.writestr('FILESET_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
  stream.flush();os.fsync(stream.fileno())
 with zipfile.ZipFile(temporary) as z:
  if z.testzip() is not None:raise RuntimeError('ZIP CRC failed')
  for a in records:
   with z.open(a['path']) as incoming:
    digest=hashlib.sha256();size=0
    while block:=incoming.read(1024*1024):digest.update(block);size+=len(block)
   if size!=a['bytes'] or digest.hexdigest()!=a['sha256']:raise RuntimeError('ZIP file mismatch: '+a['path'])
 os.replace(temporary,path)
 print(json.dumps({'file':path.name,'bytes':path.stat().st_size,'sha256':sha(path),'verified_files':len(records)}),flush=True)
 return manifest

JOIN_SCRIPT=r'''param([string]$Directory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$manifestPath = Join-Path $Directory 'Installer_Delivery_Manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.installer.name -ne [IO.Path]::GetFileName($manifest.installer.name)) { throw 'Invalid installer filename' }
$output = Join-Path $Directory $manifest.installer.name
if (Test-Path -LiteralPath $output) {
    if ((Get-Item -LiteralPath $output).Length -eq $manifest.installer.bytes -and (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant() -eq $manifest.installer.sha256) {
        Write-Host "Verified installer already present: $output"
        return
    }
    throw 'A different output file already exists. Move it before joining.'
}
foreach ($part in $manifest.parts) {
    if ($part.name -ne [IO.Path]::GetFileName($part.name)) { throw 'Invalid part filename' }
    $path = Join-Path $Directory $part.name
    if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing delivery part: $($part.name)" }
    if ((Get-Item -LiteralPath $path).Length -ne $part.bytes) { throw "Incomplete delivery part: $($part.name)" }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $part.sha256) { throw "Hash mismatch: $($part.name)" }
}
$temporary = $output + '.joining-' + [Guid]::NewGuid().ToString('N')
$destination = $null
try {
    $destination = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    foreach ($part in $manifest.parts) {
        $source = [IO.File]::OpenRead((Join-Path $Directory $part.name))
        try { $source.CopyTo($destination, 4194304) } finally { $source.Dispose() }
    }
    $destination.Flush($true)
    $destination.Dispose()
    $destination = $null
    if ((Get-Item -LiteralPath $temporary).Length -ne $manifest.installer.bytes -or (Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.installer.sha256) { throw 'Reconstructed installer verification failed' }
    [IO.File]::Move($temporary, $output)
    Write-Host "Verified single installer: $output"
    Write-Host 'Run this EXE to install. No Node or external Python is required.'
} finally {
    if ($null -ne $destination) { $destination.Dispose() }
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
}
'''

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--handoff-root',type=Path,required=True);parser.add_argument('--release-root',type=Path,required=True);args=parser.parse_args();root=args.handoff_root.resolve();program=root/'program';out=args.release_root.resolve();out.mkdir(parents=True,exist_ok=True)
 if out.is_relative_to(root):raise ValueError('Release directory must be outside the handoff source tree')
 checks=json.loads((program/'audit/Packaging_Checks.json').read_text())
 if not checks.get('passed') or checks.get('release_version')!='3.0.0':raise RuntimeError('Current installer verification must pass first')
 installer=program/'build'/checks['installer_name']
 if installer.stat().st_size!=checks['installer_bytes'] or sha(installer)!=checks['installer_sha256']:raise RuntimeError('Installer changed after verification')
 size=installer.stat().st_size;part_size=math.ceil(size/4)
 if part_size>536870912:raise RuntimeError('Four parts exceed the delivery limit')
 parts=[]
 with installer.open('rb') as incoming:
  for i in range(1,5):
   name=f'Voice_Profile_Studio_3.0.0_Setup.part{i:02d}';path=out/name;temporary=path.with_name(path.name+'.building');digest=hashlib.sha256();written=0
   with temporary.open('wb') as stream:
    while written<part_size:
     block=incoming.read(min(4194304,part_size-written))
     if not block:break
     stream.write(block);digest.update(block);written+=len(block)
    stream.flush();os.fsync(stream.fileno())
   os.replace(temporary,path)
   if written==0 or path.stat().st_size!=written or sha(path)!=digest.hexdigest():raise RuntimeError('Part write mismatch')
   parts.append({'name':name,'bytes':written,'sha256':digest.hexdigest()})
  if incoming.read(1):raise RuntimeError('Incomplete split')
 digest=hashlib.sha256();joined_bytes=0
 for a in parts:
  with (out/a['name']).open('rb') as stream:
   while block:=stream.read(4194304):digest.update(block);joined_bytes+=len(block)
 if joined_bytes!=size or digest.hexdigest()!=checks['installer_sha256']:raise RuntimeError('Independent concatenation verification failed')
 delivery={'schema_version':'1.0.0','program_version':'3.0.0','installer':{'name':installer.name,'bytes':size,'sha256':checks['installer_sha256']},'parts':parts,'part_limit_bytes':536870912,'independent_concatenation_verified':True,'delivery_parts_are_runtime_dependencies':False,'publisher_signed':False,'actual_windows_execution_verified':False,'powerShell_execution_verified':False,'python_stream_equivalent_verified':True}
 json_write(out/'Installer_Delivery_Manifest.json',delivery);write(out/'Join_Voice_Profile_Installer.ps1',JOIN_SCRIPT.encode('utf-8-sig'))
 instructions=f'''# Install Voice Profile Studio 3.0 Offline

Download all four .part files, Join_Voice_Profile_Installer.ps1 and Installer_Delivery_Manifest.json into one folder. Windows built-in PowerShell joins the transport parts into one installer after checking every part and the final SHA-256. No Node, separate Python or archive utility is required. Allow about 12 GB working disk space while retaining the parts, EXE and installed application.

Open PowerShell in that folder and run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\Join_Voice_Profile_Installer.ps1
```

The override applies only to this invocation. Read the script before running it. It checks and joins files; it does not install automatically or overwrite a different existing EXE. Then run {installer.name}. Standard installer pages offer all twelve languages; an existing user preference is retained. The installed application bundles its private runtime, models, voice data, fonts and guides and requires no Internet connection or Node/Python installation.

The single EXE is {size:,} bytes, SHA-256 {checks['installer_sha256']}. Each saved file is limited to 512 MiB, which is why delivery uses four parts. They and the script are transport only and are not required by the installed application. Their independent streamed concatenation has been verified; actual PowerShell execution and Windows installation/startup/playback/offline acceptance/uninstall remain unverified. Installer unsigned; F5 weights retain noncommercial terms.

Read the User Guide, Quick Start and Release Audit. English/Mandarin reference-conditioned renders passed current text checks. Generic speech is experimental in all twelve languages; all twelve current ASR checks failed, and human likeness/native-speaker review remains pending. Upload the Replit fileset and task query to your existing ENGRAM project for implementation; its repository has not been modified here.
'''
 write(out/'Download_and_Install.md',instructions.encode())
 for name in ['Installer_Delivery_Manifest.json','Join_Voice_Profile_Installer.ps1','Download_and_Install.md']:shutil.copy2(out/name,program/'docs'/name)
 status=json.loads((root/'RELEASE_STATUS.json').read_text());status.update(stage='Compiled installer, full archive/payload/resource verification and delivery reconstruction passed; Windows and human review pending',windows_installer_built=True,windows_archive_and_payload_verified=True,installer_delivery_parts_verified=True,publisher_signed=False,actual_windows_execution_verified=False,installer=delivery['installer'],standalone_has_external_node_requirement=False,engram_app_modified=False,professional_translation_review='pending',human_voice_review='pending')
 json_write(root/'RELEASE_STATUS.json',status);json_write(program/'audit/RELEASE_STATUS.json',status)
 shutil.copy2(program/'build/package/app/payload_manifest.json',program/'audit/final_payload_manifest.json');shutil.copy2(program/'build/package/app/runtime_manifest.json',program/'audit/runtime_manifest_v3.json')
 old=json.loads((program/'audit/Rebecca_Final_Audited_Voice_Profile.json').read_text());native=json.loads((program/'audit/native_generation_v3.json').read_text());english=json.loads((program/'example_workspace/generations'/native['renders'][0]['generation_id']/'audit.json').read_text())
 if old['generation_audit']['id']!=english['id']:old.setdefault('prior_generation_audits',[]).append(old['generation_audit'])
 old['generation_audit']=english;old['language_update']={'program_version':'3.0.0','interface_languages':['en','es','fr','de','pt','it','ru','ja','ko','zh-Hans','ar','hi'],'independent_settings':True,'arabic_RTL':True,'automatic_reply':'host-confirmed user language','reference_track_unchanged':True,'generic_is_character_imitation':False,'current_native_tests':native,'generic_test_summary':{'signal_valid':12,'text_check_passed':0,'native_speaker_review':'pending'}};old['verification'].update(program_version='3.0.0',delivery_audio_sha256=native['renders'][0]['word_check']['audio_sha256'],program_tests_passed=108,integration_tests_passed=17,worker_bridge_tests_passed=5,windows_execution_verified=False,human_listening_review='pending',audit_is_not_likeness_approval=True)
 old['engram_context'].update(language_settings={'interface_language':'en','reply_language':'auto','transcription_language':'auto','synthesis_language':'en','speech_engine':'f5'},reply_language_contract={'requested_language':'auto','resolved_language':None,'automatic_policy':'follow_user_language','host_must_confirm_language':True,'translate_sources':False,'studio_generates_chat':False})
 json_write(program/'audit/Rebecca_Final_Audited_Voice_Profile.json',old);json_write(out/'Rebecca_Final_Audited_Voice_Profile.json',old)
 for source,name in [(program/'docs/User_Guide.pdf','Voice_Profile_Studio_3.0.0_User_Guide.pdf'),(program/'docs/Quick_Start.pdf','Voice_Profile_Studio_3.0.0_Quick_Start.pdf'),(program/'docs/Release_Audit.pdf','Voice_Profile_Studio_3.0.0_Release_Audit.pdf'),(program/'audit/Packaging_Checks.json','Voice_Profile_Studio_3.0.0_Packaging_Checks.json'),(root/'REPLIT_TASK_QUERY.md','Engram_Voice_Profile_Replit_Task_Query.md'),(root/'ENGRAM_Document_Alignment.md','ENGRAM_Document_Alignment.md'),(program/'example_workspace/generations'/native['renders'][0]['generation_id']/'generated.wav','Voice_Profile_Studio_3.0.0_Noncanon_Test.wav')]:shutil.copy2(source,out/name)
 generic=json.loads((program/'audit/multilingual_audio.json').read_text());test_files=[('audit/native_generation_v3.json',program/'audit/native_generation_v3.json'),('audit/multilingual_audio.json',program/'audit/multilingual_audio.json')]
 for test in generic['tests']+native['renders']:
  folder=program/'example_workspace/generations'/test['generation_id']
  for file in sorted(folder.iterdir()):
   if file.is_file():test_files.append((test['language']+'/'+test['generation_id']+'/'+file.name,file))
 review=out/'Multilingual_Test_Readme.md';write(review,b'# Multilingual voice tests\n\nFourteen real generation records: twelve experimental generic clips and English/Mandarin reference-conditioned tests. Generic clips do not imitate Rebecca. All twelve generic text checks failed; signal checks passed. Reference-conditioned English WER 6.25% and Mandarin CER 14.29% passed a 20% criterion. Raw transcripts, disclosed character-only mapping and failed checks are retained. All human listening ratings remain unreviewed; likeness, pronunciation and Windows execution are not approved.\n');test_files.append(('README.md',review));archive(out/'Voice_Profile_Studio_3.0.0_Multilingual_Tests.zip',test_files)
 def eligible(path):
  r=path.relative_to(root);parts=r.parts
  if any(x.startswith('.') for x in parts) and r.as_posix()!='.replit.example':return False
  if any(x=='__pycache__' or x.endswith('.pyc') or '.openai-download-' in x for x in parts):return False
  if parts[0] in ['native_validation_v3'] or r.name in ['native_v3_settings.json','FILESET_MANIFEST.json']:return False
  if parts[:3]==('program','build','package'):return False
  if parts[:2]==('program','models') and r.name!='manifest.json':return False
  if parts[:2]==('program','build') and (r.suffix in ['.exe','.nsh'] or r.name.endswith('.building')):return False
  return path.is_file() and not path.is_symlink()
 files=[(p.relative_to(root).as_posix(),p) for p in sorted(root.rglob('*')) if eligible(p)]
 manifest=archive(out/'Engram_Voice_Profile_Replit_Fileset.zip',files);json_write(root/'FILESET_MANIFEST.json',manifest)
 # Both deliverables use the same coherent layout: native code under program/,
 # adapters/contracts at the root. This also keeps build and test paths valid.
 archive(out/'Voice_Profile_Studio_3.0.0_Source_and_Audit.zip',files)
 json_write(out/'Release_Delivery_Checks.json',{'delivery':delivery,'saved_file_candidates':[{'name':p.name,'bytes':p.stat().st_size,'sha256':sha(p)} for p in sorted(out.iterdir()) if p.is_file() and p.name!='Release_Delivery_Checks.json'],'source_and_fileset_verified':True})
 print('All delivery artifacts verified.',flush=True)

if __name__=='__main__':main()
