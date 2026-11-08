"""Immutable render audio and append-only listening review history."""
from pathlib import Path
import hashlib,json,re,shutil
from . import synthesis
from .engine import identifier,now,write_json
from .sdk import VoiceLibrary

def directory(studio,rid):
 if not isinstance(rid,str) or not re.fullmatch(r'render_[a-f0-9]{16}',rid):raise ValueError('Invalid render identifier.')
 p=studio.root/'renders'/rid
 if not (p/'receipt.json').is_file():raise ValueError('Render not found.')
 return p
def receipts(studio):
 with studio.lock:return sorted([json.loads(p.read_text(encoding='utf-8')) for p in (studio.root/'renders').glob('render_*/receipt.json')],key=lambda x:x['created_at'],reverse=True)
def generate(studio,body):
 synthesis.validate(body['text'],body.get('rate',1),body.get('pitch',0),body.get('volume',0),body.get('steps',32),body.get('seed',0),body.get('reference_text',''))
 archive=studio.export([body['profile_id']],'FLOAT32',body.get('quality_policy','high_fidelity'));lib=VoiceLibrary(archive.with_suffix(''))
 request=lib.expression_request(body['profile_id'],body['text'],body.get('style','neutral'),body.get('rate',1),body.get('pitch',0),body.get('volume',0))
 reference=Path(request['reference'].pop('absolute_path'));rid=identifier('render');p=studio.root/'renders'/rid;p.mkdir(parents=True)
 try:
  shutil.copy2(reference,p/'reference.wav')
  result=synthesis.render(p/'reference.wav',request,p/'speech.wav',body.get('reference_text',''),body.get('steps',32),body.get('seed',0),body.get('scene_notes',''))
  result.update({'id':rid,'created_at':now(),'profile_id':body['profile_id'],'reference_package':archive.name,'audio_path':f'/api/renders/{rid}/speech.wav','reference_audio_path':f'/api/renders/{rid}/reference.wav','receipt_path':f'/api/renders/{rid}/receipt.json'})
  write_json(p/'receipt.json',result);return result
 except Exception:shutil.rmtree(p,ignore_errors=True);raise
def review(studio,rid,status,notes=''):
 if status not in ('approved','needs_revision','unreviewed') or not isinstance(notes,str) or len(notes)>10000:raise ValueError('Invalid review status or notes.')
 with studio.lock:
  p=directory(studio,rid);receipt=json.loads((p/'receipt.json').read_text(encoding='utf-8'))
  if hashlib.sha256((p/'speech.wav').read_bytes()).hexdigest()!=receipt['audio_sha256']:raise ValueError('Rendered audio changed. Review cannot be attached.')
  receipt['review_status']=status;receipt.setdefault('review_history',[]).append({'status':status,'notes':notes,'created_at':now()});write_json(p/'receipt.json',receipt);return receipt
