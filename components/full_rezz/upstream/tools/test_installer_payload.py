"""Exercise the installer transaction with tiny fixtures; no Windows execution claim."""
from pathlib import Path
import hashlib,importlib.util,json,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('installer_payload',ROOT/'tools/installer_payload.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
def fixture(path,values,tamper=None):
 entries=[{'path':n,'bytes':len(v),'sha256':hashlib.sha256(v).hexdigest()} for n,v in values.items()];raw=json.dumps({'version':'3.0.0','files':entries}).encode();module.EXPECTED_MANIFEST_SHA256=hashlib.sha256(raw).hexdigest();path.write_bytes(b'MZ fixture only; not executable\n')
 with zipfile.ZipFile(path,'a') as z:
  for n,v in values.items():z.writestr(n,tamper if tamper is not None and n=='app/voice_studio/core.py' else v)
  z.writestr('FULL_REZZ_PAYLOAD_MANIFEST.json',raw)
def main():
 checks=[]
 with tempfile.TemporaryDirectory(prefix='full-rezz-install-check-') as temp:
  root=Path(temp);installer=root/'fixture.exe';destination=root/'program';values={'app/voice_studio/core.py':b'new code','python/runtime.marker':b'private interpreter'};fixture(installer,values);module.install(installer,destination);assert (destination/'app/voice_studio/core.py').read_bytes()==b'new code';checks.append('complete installation hashes')
  workspace=root/'workspace';workspace.mkdir();(workspace/'user.json').write_text('preserved');(destination/'app/voice_studio/core.py').write_bytes(b'old code');fixture(installer,values);module.install(installer,destination);backups=list(root.glob('program.previous-*'));assert any((p/'app/voice_studio/core.py').read_bytes()==b'old code' for p in backups);assert (workspace/'user.json').read_text()=='preserved';checks+=['recognized upgrade retains previous program','workspace untouched']
  fixture(installer,values,b'bad code')
  try:module.install(installer,destination)
  except ValueError:pass
  else:raise AssertionError('Tampered payload was accepted')
  assert (destination/'app/voice_studio/core.py').read_bytes()==b'new code';assert not list(root.glob('program.install-*'));checks+=['corrupt file leaves existing installation intact','failed stage removed']
  fixture(installer,{'../escape':b'bad'})
  try:module.install(installer,root/'unsafe')
  except ValueError:pass
  else:raise AssertionError('Traversal accepted')
  assert not (root/'escape').exists();checks.append('traversal rejected')
  fixture(installer,values);unrecognized=root/'other';unrecognized.mkdir();(unrecognized/'user.txt').write_text('retained')
  try:module.install(installer,unrecognized)
  except ValueError:pass
  else:raise AssertionError('Unrecognized data directory replaced')
  assert (unrecognized/'user.txt').read_text()=='retained';checks.append('nonempty unrecognized directory retained')
  module.EXPECTED_MANIFEST_SHA256='0'*64
  try:module.install(installer,root/'wrong-manifest')
  except ValueError:pass
  else:raise AssertionError('Wrong embedded manifest hash accepted')
  checks.append('manifest pin checked')
 report={'passed_transaction_checks':checks,'checks':len(checks),'execution':'actual Python transaction with small fixture payloads','native_windows_execution_tested':False};(ROOT/'evidence/product_v3/Installer_Transaction_Check.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
