"""Isolated inference worker, controlled by the native desktop process."""
import sys,json,traceback,zipfile
from pathlib import Path
from .runtime import enforce_offline,health
from .engine import Studio,write_json
from .synthesis import RenderManager
from . import spectrum,audio

def run(task):
 from full_rezz_companion.worker_lifetime import attach
 attach()
 enforce_offline();s=Studio(Path(task['workspace']));a=task.get('args',{});op=task['operation'];g=RenderManager(s)
 if op=='import':return s.import_audio(Path(a['path']))
 if op=='analyze':return s.analyze(a['rid'],a['method'],a.get('count'))
 if op=='transcribe':return s.transcribe(a['rid'],language=a.get('language'))
 if op=='separate':return s.separate(a['rid'],a['start'],a['end'])
 if op=='quality':
  report=s.audio_quality(a['rid'],a['start'],a['end'],a.get('channel'));sr,x=s.samples(a['rid']);full=audio.mono(x,a.get('channel'));y=full[round(a['start']*sr):round(a['end']*sr)];z,_=s._condition(y,sr,full,s.record(a['rid']));report['spectrum']={'original':spectrum.measure(y,sr),'conditioned':spectrum.measure(z,sr)};return report
 if op=='source':
  p=Path(a['path']);return s.import_source(a['pid'],p.read_bytes(),p.name)
 if op=='draft':return s.draft_character(a['pid'])
 if op=='generate':return g.generate(**a)
 if op=='recheck':return g.recheck(a['gid'])
 if op=='export':return {'path':str(s.export(a.get('profiles'),a['encoding'],a['policy']))}
 if op=='health':return health(True)
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
   return companion.speak(pid,text,settings)
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
 write_json(Path(task['result_path']),result);print(json.dumps({'ok':result['ok']}),flush=True)
 raise SystemExit(0 if result['ok'] else 1)
