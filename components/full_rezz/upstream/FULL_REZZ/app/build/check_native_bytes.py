"""Byte identity against independently verified saved runtime and upstream MSI.
Never use a newly frozen v3 manifest as its own acquisition evidence.
"""
from pathlib import Path
import hashlib,json
root=Path(__file__).resolve().parents[1];bundle=root/'build/package'
baseline=json.loads((root/'audit/prior_release_2.0/payload_manifest.json').read_text())
original={a['path']:a for a in baseline['files']}
vendor=json.loads((root/'vendor/espeak-ng/manifest.json').read_text())
new={"app/vendor/espeak-ng/"+a['path']:a for a in vendor['assets']}
errors=[];checked=0;groups={'verified_saved_runtime':0,'unchanged_upstream_MSI':0}
for p in bundle.rglob('*'):
 if p.suffix.lower() not in ('.dll','.pyd','.exe') or p.name=='VoiceProfileStudio.exe':continue
 relative=p.relative_to(bundle).as_posix();expected=original.get(relative) or new.get(relative)
 checked+=1
 if expected is None or p.stat().st_size!=expected['bytes'] or hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=expected['sha256']:errors.append(relative)
 else:groups['verified_saved_runtime' if relative in original else 'unchanged_upstream_MSI']+=1
result={'checked':checked,'groups':groups,'errors':errors,'passed':not errors,'baseline_installer_sha256':'fb746d498ac929acf6890a33a60182c026f5c8c36b5505f37027edc9d6585b03','msi_sha256':vendor['msi_sha256'],'limits':'Byte identity against independently verified saved dependencies and unmodified MSI files; Windows execution remains untested.'}
(root/'audit/native_binary_identity.json').write_text(json.dumps(result,indent=2));print(json.dumps(result),flush=True)
if errors:raise RuntimeError('Native dependency byte mismatch')
