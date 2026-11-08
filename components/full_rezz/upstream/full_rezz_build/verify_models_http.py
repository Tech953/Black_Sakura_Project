"""Actual bundled inference and loopback transport; does not approve acting or identity."""
import sys,os,json,time,threading,urllib.request,hashlib,zipfile,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];APP=ROOT/'FULL_REZZ/app';sys.path.insert(0,str(APP))
from voice_studio import offline
offline.activate()
from voice_studio import models,audio,render_store
from voice_studio.engine import Studio
from voice_studio.server import AppServer
studio=Studio(ROOT/'full_rezz_build/integration_project');server=AppServer(('127.0.0.1',0),studio);threading.Thread(target=server.serve_forever,daemon=True).start();base=f'http://127.0.0.1:{server.server_port}';report={'environment':'Linux CPU actual neural inference and loopback HTTP; native Windows and human listening untested','checks':[]}
def record(name,result):
 report['checks'].append({'name':name,'result':result});(APP/'audit-artifacts/offline-integration.json').write_text(json.dumps(report,indent=2)+'\n');print(name,flush=True)
def request(path,data=None,raw=False):
 headers={'X-Studio-Token':server.token,'Origin':base};body=data if raw else json.dumps(data).encode() if data is not None else None
 with urllib.request.urlopen(urllib.request.Request(base+path,body,headers),timeout=120) as response:return response.read()
try:
 manifest=offline.verify_models();record('All bundled model sizes and SHA256 match',{'files':len(manifest['files']),'bytes':sum(x['size_bytes'] for x in manifest['files'])})
 archive=ROOT/'upload/Rebecca_Audited_Voice_Profile.zip';result=json.loads(request('/api/portable-import',archive.read_bytes(),True));record('Actual 339-entry archive restored with active reference pack',result)
 pid=result['profile_ids'][0];rid=result['recording_ids'][0];rec=studio.record(rid);sr,data=studio.samples(rid)
 start=time.monotonic();asr=models.transcribe(data,sr);record('English local transcription actual inference',{'elapsed_seconds':time.monotonic()-start,'text':' '.join(x['text'] for x in asr['segments']),'manual_words':rec['segments'][0]['text'],'manual_words_preserved':True})
 start=time.monotonic();speakers=models.diarize(data,sr,1);vectors=list(speakers['embeddings'].values());assert len(vectors)==1 and len(vectors[0])==192;record('ECAPA actual 192-dimensional local embedding',{'elapsed_seconds':time.monotonic()-start,'regions':len(speakers['segments']),'dimensions':len(vectors[0]),'identity_unverified':True})
 start=time.monotonic();sep_sr,sources=models.separate(data[:sr*2],sr,studio.root/'model_cache');assert sep_sr==8000 and sources.shape==(16000,2);record('Actual SepFormer anonymous separation',{'elapsed_seconds':time.monotonic()-start,'sample_rate':sep_sr,'samples':len(sources),'outputs':2,'listening_pending':True})
 expected='The offline archive is ready.'
 job=json.loads(request('/api/jobs',{'kind':'render','profile_id':pid,'text':expected,'style':'concern','steps':32,'seed':42,'rate':1,'pitch':0,'volume':0,'reference_text':rec['segments'][0]['text'],'scene_notes':'Authored local program validation statement.'}))
 while True:
  state=json.loads(request('/api/state'));current=next(x for x in state['jobs'] if x['id']==job['id'])
  if current['status'] in ('completed','failed'):break
  time.sleep(.3)
 assert current['status']=='completed',current;receipt=current['result'];wave=request(receipt['audio_path']);assert hashlib.sha256(wave).hexdigest()==receipt['audio_sha256'];assert request(receipt['reference_audio_path'])==(render_store.directory(studio,receipt['id'])/'reference.wav').read_bytes()
 out_sr,out=audio.read_audio(render_store.directory(studio,receipt['id'])/'speech.wav');heard=' '.join(x['text'] for x in models.transcribe(out,out_sr)['segments']);norm=lambda x:re.sub(r'[^a-z0-9]','',x.lower());assert norm(heard)==norm(expected),(heard,expected)
 record('F5 + Vocos actual 32-step synthesis, downloaded WAV and word check',{'receipt':receipt,'heard':heard,'word_check':'exact normalized match','wave_bytes':len(wave),'sample_rate':out_sr,'human_listening_pending':True})
 reviewed=json.loads(request('/api/render-review',{'render_id':receipt['id'],'status':'needs_revision','notes':'Automated transport, word and signal checks passed. Human listening, acting and likeness review still pending.'}));assert reviewed['review_status']=='needs_revision';assert json.loads(request(receipt['receipt_path']))['review_history']==reviewed['review_history'];record('Receipt download and review persistence',{'status':'needs_revision','history_entries':len(reviewed['review_history'])})
 pack=studio.export([pid]);
 with zipfile.ZipFile(pack) as z:assert z.testzip() is None;assert z.read('original_imports/'+result['import_id']+'/original.zip')==archive.read_bytes()
 record('Re-export preserves every original archive byte',{'zip_crc':'passed','original_archive_sha256':hashlib.sha256(archive.read_bytes()).hexdigest()})
 assert 'onnxruntime' not in sys.modules;record('ONNX Runtime absent during all four actual neural paths',True)
finally:server.shutdown();server.server_close()
