"""Create transport ZIPs for one exact standalone installer, using only Windows built-ins to assemble."""
from pathlib import Path
import zipfile,json,hashlib,os,shutil
ROOT=Path(__file__).resolve().parents[1];BUILD=ROOT/'full_rezz_build';EXE=BUILD/'FULL_REZZ_2.0_Offline_Setup.exe';CHUNK=536000000;report=json.loads((ROOT/'FULL_REZZ_Installer_Verification.json').read_text());expected=report['installer_sha256'];count=(EXE.stat().st_size+CHUNK-1)//CHUNK;assert count==4,count
CMD='''@echo off
setlocal
cd /d "%~dp0"
set "target=FULL_REZZ_2.0_Offline_Setup.exe"
for %%P in (01 02 03 04) do if not exist "%target%.part%%P" goto missing
if exist "%target%" goto verify
if exist "%target%.building" del "%target%.building"
copy /b "%target%.part01"+"%target%.part02"+"%target%.part03"+"%target%.part04" "%target%.building" >nul
if errorlevel 1 goto failed
powershell.exe -NoProfile -Command "$h=(Get-FileHash -LiteralPath 'FULL_REZZ_2.0_Offline_Setup.exe.building' -Algorithm SHA256).Hash; if ($h -ne 'EXPECTED') { exit 1 }"
if errorlevel 1 goto failed
move "%target%.building" "%target%" >nul
if errorlevel 1 goto failed
:verify
powershell.exe -NoProfile -Command "$h=(Get-FileHash -LiteralPath 'FULL_REZZ_2.0_Offline_Setup.exe' -Algorithm SHA256).Hash; if ($h -ne 'EXPECTED') { exit 1 }"
if errorlevel 1 goto failed
echo Installer verified. Starting FULL_REZZ setup.
start "" "%target%"
exit /b 0
:missing
echo Extract ALL FOUR installer ZIPs into this same folder, then run again.
pause
exit /b 1
:failed
echo Assembly or SHA256 verification failed. Setup was not started.
echo Keep the fragments and download any damaged or missing part again.
pause
exit /b 1
'''.replace('EXPECTED',expected).replace('\n','\r\n')
README=f'''FULL_REZZ 2.0 offline Windows installer\n\nExtract all four ZIPs into one folder. Run Assemble_Installer.cmd. Windows built-in copy /b and Get-FileHash reconstruct and verify the single installer, then launch it. No Python, Node, archive utility, account, model download or separately installed runtime is needed. Installed operation is entirely local.\n\nInstaller SHA256: {expected}\nInstaller bytes: {EXE.stat().st_size}\n\nUnsigned build. Native Windows installation/GUI testing and human listening are pending. Consult FULL_REZZ_User_Guide.pdf and FULL_REZZ_Audit.md. F5 weights are CC-BY-NC-4.0 (noncommercial). The 60 fps demonstration uses 23 scheduled body drawings, not arbitrary action generation.\n'''
parts=[];recombined=hashlib.sha256();total=0
with EXE.open('rb') as source:
 for i in range(1,5):
  data=source.read(CHUNK);name=f'{EXE.name}.part{i:02d}';target=ROOT/f'FULL_REZZ_Installer_Part_{i:02d}.zip';stage=target.with_suffix('.staged')
  with zipfile.ZipFile(stage,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as z:
   z.writestr(name,data)
   if i==1:z.writestr('Assemble_Installer.cmd',CMD);z.writestr('INSTALL_README.txt',README);z.writestr('FULL_REZZ_Installer_Verification.json',json.dumps(report,indent=2)+'\n')
  with zipfile.ZipFile(stage) as z:
   assert z.testzip() is None;stored=z.read(name);assert stored==data;recombined.update(stored);total+=len(stored)
  with stage.open('rb') as f:os.fsync(f.fileno())
  os.replace(stage,target);assert target.stat().st_size<=536870912
  parts.append({'filename':target.name,'size_bytes':target.stat().st_size,'fragment':name,'fragment_bytes':len(data),'fragment_sha256':hashlib.sha256(data).hexdigest()});print(target.name,len(data),flush=True)
 assert not source.read(1)
assert total==EXE.stat().st_size and recombined.hexdigest()==expected
manifest={'program':'FULL_REZZ','installer':report,'parts':parts,'assembly_byte_equivalence_verified':True,'windows_cmd_execution_tested':False,'delivery_limit_bytes':536870912}
(ROOT/'FULL_REZZ_Delivery_Manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');(BUILD/'Assemble_Installer.cmd').write_bytes(CMD.encode('ascii'));print('All transport fragments reconstruct the verified installer',flush=True)
