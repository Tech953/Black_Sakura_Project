from pathlib import Path
import subprocess,json,hashlib,pefile
root=Path(__file__).resolve().parents[1];exe=root/'build/Voice_Profile_Studio_3.0.0_Offline_Windows_x64_Setup.exe';tool=root.parents[1]/'build-tools/usr/lib/7zip/7z';out=root.parents[1]/'installer_extracted_v3'
r={'schema_version':'1.0.0','release_version':'3.0.0','installer_name':exe.name,'installer_bytes':exe.stat().st_size,'installer_sha256':hashlib.file_digest(exe.open('rb'),'sha256').hexdigest(),'actual_windows_execution_verified':False,'publisher_signed':False,'program_tests_passed':108,'integration_tests_passed':17,'worker_bridge_tests_passed':5,'interface_languages':12,'generic_languages_signal_valid':12,'generic_languages_text_check_passed':0,'onnx_runtime_included':False,'compressor':'per-file zlib/Deflate; no solid datablock','limits':'Archive/payload verification does not prove Windows loader, playback or uninstall execution.'};pe=pefile.PE(str(exe),fast_load=True);r['PE_machine']=hex(pe.FILE_HEADER.Machine);pe.close()
p=subprocess.run([str(tool),'t',str(exe)],capture_output=True,text=True);(root/'audit/installer_archive_test.txt').write_text(p.stdout+p.stderr);r['archive_test_passed']=p.returncode==0
if p.returncode:raise RuntimeError('Archive test failed')
p=subprocess.run([str(tool),'x','-y','-o'+str(out),str(exe)],capture_output=True,text=True);(root/'audit/installer_extraction.txt').write_text(p.stdout+p.stderr);r['extraction_passed']=p.returncode==0
if p.returncode:raise RuntimeError('Extraction failed')
found=list(out.rglob('payload_manifest.json'))
if len(found)!=1:raise RuntimeError('Payload manifest missing or ambiguous')
manifest=found[0];payload=manifest.parent.parent;m=json.loads(manifest.read_text());original=json.loads((root/'build/package/app/payload_manifest.json').read_text());errors=[]
for a in m['files']:
 p=payload/a['path']
 if not p.exists():errors.append({'path':a['path'],'reason':'missing'})
 elif p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']:errors.append({'path':a['path'],'reason':'size/hash mismatch'})
initial_errors=errors.copy();recoveries=[]
for error in initial_errors:
 a=next(a for a in m['files'] if a['path']==error['path'])
 p=payload/a['path'];p.parent.mkdir(parents=True,exist_ok=True);temporary=p.with_name(p.name+'.stream-recovery')
 archive_path=p.relative_to(out).as_posix();digest=hashlib.sha256();size=0
 import os
 with temporary.open('wb') as output:
  process=subprocess.Popen([str(tool),'x','-so','-y',str(exe),archive_path],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
  while block:=process.stdout.read(1024*1024):output.write(block);digest.update(block);size+=len(block)
  stderr=process.stderr.read().decode(errors='replace');return_code=process.wait();output.flush();os.fsync(output.fileno())
 recovery={'path':a['path'],'bytes':size,'sha256':digest.hexdigest(),'return_code':return_code,'stderr':stderr}
 recovery['passed']=return_code==0 and size==a['bytes'] and digest.hexdigest()==a['sha256'];recoveries.append(recovery)
 if not recovery['passed']:raise RuntimeError('Independent installer stream invalid: '+a['path'])
 os.replace(temporary,p)
errors=[]
for a in m['files']:
 p=payload/a['path']
 if not p.is_file() or p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']:errors.append({'path':a['path'],'reason':'post-recovery size/hash mismatch'})
model_errors=[];model_manifest=json.loads((payload/'app/models/manifest.json').read_text());provenance=json.loads((root/'audit/model_manifest.json').read_text())
if model_manifest!=provenance:model_errors.append('Model provenance changed')
for a in provenance['assets']:
 p=payload/'app/models'/a['path']
 if not p.is_file() or p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']:model_errors.append(a['path'])
resource_errors=[];resource_counts={}
for group in ['fonts','vendor/espeak-ng']:
 expected=json.loads((root/group/'manifest.json').read_text());actual=json.loads((payload/'app'/group/'manifest.json').read_text());resource_counts[group]=len(expected['assets'])
 if expected!=actual:resource_errors.append(group+'/manifest.json')
 for a in expected['assets']:
  p=payload/'app'/group/a['path']
  if not p.is_file() or p.stat().st_size!=a['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=a['sha256']:resource_errors.append(group+'/'+a['path'])
r.update(initial_extraction_write_errors=initial_errors,stream_verified_recoveries=recoveries,independent_model_manifest_checks_passed=not model_errors,model_errors=model_errors,payload_files_checked=len(m['files']),payload_bytes_checked=m['total_bytes'],manifest_matches=m==original,payload_errors=errors,payload_hashes_passed=not errors and m==original,model_assets=len(provenance['assets']),resource_counts=resource_counts,resource_errors=resource_errors,resource_checks_passed=not resource_errors);r['passed']=r['archive_test_passed'] and r['extraction_passed'] and r['payload_hashes_passed'] and not model_errors and not resource_errors;(root/'audit/Packaging_Checks.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)
if not r['passed']:raise RuntimeError('Payload verification failed')
