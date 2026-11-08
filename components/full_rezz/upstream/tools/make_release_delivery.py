"""Split a verified complete EXE into checked, version-matched transport files."""
from pathlib import Path
import argparse,hashlib,json,os,zipfile
ROOT=Path(__file__).resolve().parents[1];CHUNK=400*1024**2
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def main():
 p=argparse.ArgumentParser();p.add_argument('--release',required=True);p.add_argument('--start-dir',required=True);a=p.parse_args();d=Path(a.release);start=Path(a.start_dir);start.mkdir(parents=True,exist_ok=True)
 v=json.loads((d/'FULL_REZZ_3.0_Installer_Verification.json').read_text());exe=d/v['installer'];assert exe.stat().st_size==v['bytes'] and digest(exe)==v['sha256'];parts=[]
 with exe.open('rb') as f:
  i=1
  while block:=f.read(CHUNK):
   name=f'FULL_REZZ_3.0_Setup.part{i:02}';out=d/name;out.write_bytes(block);parts.append({'name':name,'bytes':len(block),'sha256':digest(out)});i+=1
 h=hashlib.sha256();size=0
 for e in parts:
  with (d/e['name']).open('rb') as f:
   while block:=f.read(1024**2):h.update(block);size+=len(block)
 assert size==v['bytes'] and h.hexdigest()==v['sha256']
 m={'program':'FULL_REZZ','version':'3.0.0','delivery_revision':v['delivery_revision'],'installer':{'name':exe.name,'bytes':v['bytes'],'sha256':v['sha256']},'parts':parts,'all_part_and_rejoined_hashes_verified':True,'parts_are_transport_only':True,'external_runtime_required_after_install':False,'native_windows_execution_tested':False}
 raw=json.dumps(m,indent=2)+'\n';(d/'FULL_REZZ_3.0_Delivery_Manifest.json').write_text(raw);(start/'FULL_REZZ_3.0_Delivery_Manifest.json').write_text(raw)
 ps=r'''$ErrorActionPreference = 'Stop'
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'FULL_REZZ_3.0_Delivery_Manifest.json') -Raw | ConvertFrom-Json
$target = Join-Path $PSScriptRoot $manifest.installer.name
if (Test-Path -LiteralPath $target) {
 if ((Get-Item -LiteralPath $target).Length -eq $manifest.installer.bytes -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $manifest.installer.sha256) { Write-Host 'Installer already verified.'; exit 0 }
 throw 'A different installer already exists. Move it to another folder before assembling this revision.'
}
foreach ($part in $manifest.parts) {
 $path = Join-Path $PSScriptRoot $part.name
 if (-not (Test-Path -LiteralPath $path) -or (Get-Item -LiteralPath $path).Length -ne $part.bytes -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $part.sha256) { throw ('Missing or damaged download: ' + $part.name) }
}
$staged = $target + '.assembling'
$output = [System.IO.File]::Create($staged)
try {
 foreach ($part in $manifest.parts) {
  $inputFile = [System.IO.File]::OpenRead((Join-Path $PSScriptRoot $part.name))
  try { $inputFile.CopyTo($output) } finally { $inputFile.Dispose() }
 }
} finally { $output.Dispose() }
if ((Get-Item -LiteralPath $staged).Length -ne $manifest.installer.bytes -or (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash -ne $manifest.installer.sha256) { Remove-Item -LiteralPath $staged; throw 'Reconstructed installer checksum failed.' }
Move-Item -LiteralPath $staged -Destination $target
Write-Host ('Verified: ' + $manifest.installer.name)
'''
 (start/'Assemble_FULL_REZZ_Installer.ps1').write_text(ps,encoding='utf-8-sig')
 verify="$ErrorActionPreference='Stop'; $m=Get-Content -LiteralPath 'FULL_REZZ_3.0_Delivery_Manifest.json' -Raw | ConvertFrom-Json; foreach($p in $m.parts){if(-not(Test-Path -LiteralPath $p.name) -or (Get-Item -LiteralPath $p.name).Length -ne $p.bytes -or (Get-FileHash -LiteralPath $p.name -Algorithm SHA256).Hash -ne $p.sha256){throw ('Missing or damaged download: '+$p.name)}}; if(Test-Path -LiteralPath $m.installer.name){if((Get-Item -LiteralPath $m.installer.name).Length -eq $m.installer.bytes -and (Get-FileHash -LiteralPath $m.installer.name -Algorithm SHA256).Hash -eq $m.installer.sha256){exit 2}; throw 'A different installer already exists. Move it before assembling this revision.'}"
 staged=exe.name+'.assembling'
 finish="$ErrorActionPreference='Stop'; $m=Get-Content -LiteralPath 'FULL_REZZ_3.0_Delivery_Manifest.json' -Raw | ConvertFrom-Json; $s=$m.installer.name+'.assembling'; if((Get-Item -LiteralPath $s).Length -ne $m.installer.bytes -or (Get-FileHash -LiteralPath $s -Algorithm SHA256).Hash -ne $m.installer.sha256){Remove-Item -LiteralPath $s; throw 'Reconstructed installer checksum failed'}; Move-Item -LiteralPath $s -Destination $m.installer.name; Write-Host ('Verified: '+$m.installer.name)"
 cmd='\r\n'.join(['@echo off','setlocal','cd /d "%~dp0"','powershell -NoLogo -NoProfile -Command "'+verify+'"','if errorlevel 2 goto verified','if errorlevel 1 goto failed','copy /b '+'+'.join('"'+e['name']+'"' for e in parts)+' "'+staged+'"','if errorlevel 1 goto failed','powershell -NoLogo -NoProfile -Command "'+finish+'"','if errorlevel 1 goto failed',':verified','echo The complete installer is verified. Run '+exe.name,'exit /b 0',':failed','echo Assembly failed. Read the error and keep all parts from the same release.','exit /b 1',''])
 (start/'Assemble_Installer.cmd').write_bytes(cmd.encode('ascii'))
 (start/'START_HERE.txt').write_text('FULL_REZZ 3.0 - '+v['delivery_revision']+'\n\nDownload every matching Setup.partNN file into this folder. Run Assemble_Installer.cmd. It verifies downloads and creates one complete installer; no third-party archive utility is needed. Do not mix older parts or another revision.\n\nRead the Quick_Start and User_Guide PDFs. The installed application is internally complete and offline. Native Windows device/driver/install acceptance remains pending.\n')
 for name in ['User_Guide','Quick_Start']:(start/f'FULL_REZZ_3.0_{name}.pdf').write_bytes((ROOT.parent/f'FULL_REZZ_3.0_{name}.pdf').read_bytes())
 checks=''.join(e['sha256']+'  '+e['name']+'\n' for e in parts)+v['sha256']+'  '+exe.name+'\n';(start/'CHECKSUMS.sha256').write_text(checks);(d/'FULL_REZZ_3.0_CHECKSUMS.sha256').write_text(checks)
 target=d/'FULL_REZZ_3.0_Start_Here.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
  for f in sorted(start.iterdir()):z.write(f,f.name)
 with zipfile.ZipFile(target) as z:assert z.testzip() is None
 print(json.dumps({'parts':len(parts),'total_bytes':size,'rejoined_sha256':h.hexdigest(),'start_here':str(target),'native_windows_assembly_scripts_executed':False},indent=2))
if __name__=='__main__':main()
