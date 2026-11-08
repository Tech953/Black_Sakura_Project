from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import urllib.request, json, hashlib, time
ROOT=Path(__file__).resolve().parents[1]/'models'
ROOT.mkdir(exist_ok=True)
assets=[('SWivid/F5-TTS','F5TTS_v1_Base/model_1250000.safetensors','tts/model_1250000.safetensors','CC-BY-NC-4.0'),('SWivid/F5-TTS','F5TTS_v1_Base/vocab.txt','tts/vocab.txt','CC-BY-NC-4.0')]
for repo,folder,license,names in [
 ('charactr/vocos-mel-24khz','vocos','MIT',['config.yaml','pytorch_model.bin']),
 ('Systran/faster-whisper-base','asr','MIT',['config.json','model.bin','tokenizer.json','vocabulary.txt']),
 ('speechbrain/spkrec-ecapa-voxceleb','speaker','Apache-2.0',['hyperparams.yaml','embedding_model.ckpt','mean_var_norm_emb.ckpt','classifier.ckpt','label_encoder.txt']),
 ('speechbrain/sepformer-wsj02mix','separator','Apache-2.0',['hyperparams.yaml','encoder.ckpt','decoder.ckpt','masknet.ckpt'])]:
 for n in names: assets.append((repo,n,folder+'/'+n,license))
def get(item):
 repo,remote,local,license=item;p=ROOT/local;p.parent.mkdir(parents=True,exist_ok=True)
 url='https://huggingface.co/'+repo+'/resolve/main/'+remote
 if not p.exists():
  for attempt in range(4):
   try:
    with urllib.request.urlopen(url,timeout=90) as response, p.with_suffix(p.suffix+'.part').open('wb') as out:
     while block:=response.read(4*1024*1024): out.write(block)
    p.with_suffix(p.suffix+'.part').replace(p);break
   except Exception:
    if attempt==3: raise
    time.sleep(2)
 digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
 print(local,p.stat().st_size,digest,flush=True)
 return dict(path=local,bytes=p.stat().st_size,sha256=digest,source=url,license=license)
with ThreadPoolExecutor(max_workers=5) as ex: records=list(ex.map(get,assets))
for folder in ['speaker','separator']:
 p=ROOT/folder/'custom.py';p.write_text('# Local optional SpeechBrain custom module; no custom classes.\n')
 records.append(dict(path=folder+'/custom.py',bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),license='MIT',source='Local compatibility file'))
(ROOT/'manifest.json').write_text(json.dumps({'assets':records,'runtime_downloads':False},indent=2))
