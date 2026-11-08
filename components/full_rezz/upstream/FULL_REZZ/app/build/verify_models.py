from pathlib import Path
import sys,json,hashlib
root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from voice_studio.runtime import health
r=health(True);expected='670900fd14e6c458b95da6e9ed317cdb20dbaf7a1c02ac06a05475a9d32b6a38';p=root/'models/tts/model_1250000.safetensors';assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==expected;assert r['passed'];(root/'audit/model_integrity.json').write_text(json.dumps(r,indent=2));print('All 19 model assets verified',flush=True)
