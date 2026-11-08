from pathlib import Path
import concurrent.futures,hashlib,json,os,urllib.request
DEST=Path(__file__).resolve().parents[1]/'FULL_REZZ/app/bundled_models'
SOURCES=[('f5','SWivid/F5-TTS','84e5a410d9cead4de2f847e7c9369a6440bdfaca','CC-BY-NC-4.0',['F5TTS_v1_Base/model_1250000.safetensors','F5TTS_v1_Base/vocab.txt','README.md']),('whisper','Systran/faster-whisper-tiny.en','0d3d19a32d3338f10357c0889762bd8d64bbdeba','MIT',['config.json','model.bin','tokenizer.json','vocabulary.txt','README.md']),('ecapa','speechbrain/spkrec-ecapa-voxceleb','0f99f2d0ebe89ac095bcc5903c4dd8f72b367286','Apache-2.0',['embedding_model.ckpt','classifier.ckpt','mean_var_norm_emb.ckpt','hyperparams.yaml','label_encoder.txt','README.md']),('sepformer','speechbrain/sepformer-wsj02mix','3a2826343a10e2d2e8a75f79aeab5ff3a2473531','Apache-2.0',['encoder.ckpt','decoder.ckpt','masknet.ckpt','hyperparams.yaml','README.md']),('vocos','charactr/vocos-mel-24khz','0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21','MIT',['config.yaml','pytorch_model.bin','README.md'])]
def fetch(item):
 key,repo,revision,license,remote=item;target=DEST/key/Path(remote).name;target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():
  staged=target.with_suffix(target.suffix+'.part')
  with urllib.request.urlopen(f'https://huggingface.co/{repo}/resolve/{revision}/{remote}',timeout=180) as inp,staged.open('wb') as out:
   expected=inp.headers.get('Content-Length');count=0
   while block:=inp.read(4*1024*1024):out.write(block);count+=len(block)
   out.flush();os.fsync(out.fileno())
  if expected is not None:assert count==int(expected)
  staged.replace(target)
 h=hashlib.sha256()
 with target.open('rb') as inp:
  while block:=inp.read(4*1024*1024):h.update(block)
 if key=='f5' and remote.endswith('.safetensors'):assert h.hexdigest()=='670900fd14e6c458b95da6e9ed317cdb20dbaf7a1c02ac06a05475a9d32b6a38'
 entry={'path':target.relative_to(DEST).as_posix(),'sha256':h.hexdigest(),'size_bytes':target.stat().st_size,'repository':repo,'revision':revision,'upstream_path':remote,'license':license};print(entry['path'],entry['size_bytes'],flush=True);return entry
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:entries=list(pool.map(fetch,[(k,r,v,l,n) for k,r,v,l,files in SOURCES for n in files]))
 (DEST/'manifest.json').write_text(json.dumps({'schema_version':'2.0.0','files':entries,'total_bytes':sum(e['size_bytes'] for e in entries),'runtime_downloads':False},indent=2)+'\n')
