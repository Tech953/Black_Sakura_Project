"""Isolated inference worker, controlled by the native desktop process."""
import sys,json,traceback,zipfile
from pathlib import Path
from .runtime import enforce_offline

def run(task):
 from full_rezz_companion.worker_lifetime import attach
 attach()
 enforce_offline();workspace=Path(task['workspace']);a=task.get('args',{});op=task['operation']
 if op.startswith('companion_history_'):
  from full_rezz_companion.history import HistoryStore
  history=HistoryStore(workspace,initialize=op!='companion_history_preview')
  if op=='companion_history_preview':
   data=Path(a['path']).read_bytes()
   return history.preview_import(a['pid'],data,a['filename'],a.get('mapping'))
  if op=='companion_history_list':
   limit=a.get('limit',50);offset=a.get('offset',0)
   return {'profile_id':a['pid'],'count':history.count(a['pid']),'imports':history.imports(a['pid']),
           'messages':history.messages(a['pid'],limit=limit,offset=offset)}
  if op=='companion_history_context':
   return history.retrieve_with_receipt(a['pid'],a['query'],a.get('receipt_id'),
                                        recent=a.get('recent',8),selected=a.get('selected',8),
                                        max_chars=a.get('max_chars',6500))
  if op=='companion_history_rollback':
   return history.rollback_import(a['pid'],a['import_id'])
  if op=='companion_history_export':
   return {'path':str(history.export(a['pid'],a['path']))}
  if op=='health':
   from .runtime import health
   return health(True)
 from .engine import Studio
 s=Studio(workspace)
 if op=='import':return s.import_audio(Path(a['path']))
 if op=='analyze':return s.analyze(a['rid'],a['method'],a.get('count'))
 if op=='transcribe':return s.transcribe(a['rid'],language=a.get('language'))
 if op=='separate':return s.separate(a['rid'],a['start'],a['end'])
 if op=='quality':
  from . import spectrum,audio
  report=s.audio_quality(a['rid'],a['start'],a['end'],a.get('channel'));sr,x=s.samples(a['rid']);full=audio.mono(x,a.get('channel'));y=full[round(a['start']*sr):round(a['end']*sr)];z,_=s._condition(y,sr,full,s.record(a['rid']));report['spectrum']={'original':spectrum.measure(y,sr),'conditioned':spectrum.measure(z,sr)};return report
 if op=='source':
  p=Path(a['path']);return s.import_source(a['pid'],p.read_bytes(),p.name)
 if op=='draft':return s.draft_character(a['pid'])
 if op=='generate':
  from .synthesis import RenderManager
  return RenderManager(s).generate(**a)
 if op=='recheck':
  from .synthesis import RenderManager
  return RenderManager(s).recheck(a['gid'])
 if op=='export':return {'path':str(s.export(a.get('profiles'),a['encoding'],a['policy']))}
 if op.startswith('companion_'):
  from full_rezz_companion import ConversationSession
  companion=ConversationSession(s,isolated_speech=False)
  if op=='companion_reply':return companion.reply(a['pid'],a['text'],a.get('settings'))
  if op=='companion_speech':return companion.retry_speech(a['turn_id'],a.get('settings'))
  if op=='companion_import':return dict(companion.import_history(a['pid'],a['path'],a.get('mapping')),profile_id=a['pid'])
  if op=='companion_export':
   from full_rezz_companion.exporter import export_movie
   return export_movie(companion,**a)
  if op=='companion_character':return companion.characters.import_pack(a['pid'],a['path'])
  if op=='companion_reference_import':
   from .portable_import import restore
   return restore(s,Path(a['path']),include_bridge_contexts=True)
  if op=='companion_reference_preview':
   from .portable_import import preview_archive
   return preview_archive(s,Path(a['path']))
  if op=='companion_rollback_import':
   from .portable_import import rollback_import
   return rollback_import(s,a['import_id'])
  if op=='companion_host_speech':
   pid=a['pid'];text=a['text'].strip();settings=a.get('settings') or {}
   if not text or len(text)>4000:raise ValueError('Host speech requires 1–4000 characters.')
   speech=companion.speak(pid,text,settings)
   turn_id=a.get('turn_id')
   if isinstance(turn_id,str) and turn_id:
    receipt={'turn_id':turn_id,'profile_id':pid,'reply_text':text,'speech':speech,
             'audio_status':'ready','conversation_id':a.get('conversation_id'),
             'message_id':a.get('message_id'),'full_history_retained':True}
    companion.history.save_turn(turn_id,pid,'reply_ready',receipt)
    speech['turn_id']=turn_id
   return speech
  if op=='companion_review':
   from .synthesis import RenderManager
   return RenderManager(s).review(a['generation_id'],a['ratings'],a.get('notes',''))
 if op=='backup':
  target=Path(a['path']).resolve()
  if target.is_relative_to(s.root):raise ValueError('Save backup outside the active workspace.')
  with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as z:
   for p in s.root.rglob('*'):
    if p.is_file() and not p.is_symlink() and p.name!='session.lock' and p.relative_to(s.root).parts[0] not in ('exports','jobs'):z.write(p,p.relative_to(s.root))
  return {'path':str(target)}
 raise ValueError('Unknown operation.')
if __name__=='__main__':
 task=json.loads(Path(sys.argv[1]).read_text())
 try:result={'ok':True,'result':run(task)}
 except Exception as exc:result={'ok':False,'error':str(exc),'traceback':traceback.format_exc()}
 result_path=Path(task['result_path']);temporary=result_path.with_suffix(result_path.suffix+'.tmp')
 temporary.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
 temporary.replace(result_path);print(json.dumps({'ok':result['ok']}),flush=True)
 raise SystemExit(0 if result['ok'] else 1)
