import argparse,json,sys
from pathlib import Path
from .runtime import workspace,enforce_offline,health
from .engine import Studio
from .project_lock import ProjectLock
from .sdk import VoiceLibrary

def main():
 p=argparse.ArgumentParser(description='Voice Profile Studio — offline native desktop and CLI');p.add_argument('--data-dir',type=Path,default=workspace());sub=p.add_subparsers(dest='command');sub.add_parser('list');sub.add_parser('health');sub.add_parser('demo')
 a=sub.add_parser('import');a.add_argument('file',type=Path)
 a=sub.add_parser('profile');a.add_argument('name')
 a=sub.add_parser('analyze');a.add_argument('recording_id');a.add_argument('--method',choices=['reference','channels','pyannote'],default='reference');a.add_argument('--speakers',type=int)
 a=sub.add_parser('bind');a.add_argument('recording_id');a.add_argument('speaker');a.add_argument('profile_id')
 a=sub.add_parser('quality');a.add_argument('recording_id');a.add_argument('--start',type=float,default=0);a.add_argument('--end',type=float);a.add_argument('--channel',type=int)
 a=sub.add_parser('cleanup');a.add_argument('recording_id');a.add_argument('file',type=Path)
 a=sub.add_parser('export');a.add_argument('--profile',action='append',dest='profiles');a.add_argument('--encoding',choices=['FLOAT32','PCM24','PCM16'],default='FLOAT32');a.add_argument('--quality-policy',choices=['high_fidelity','standard'],default='high_fidelity')
 a=sub.add_parser('transcribe');a.add_argument('recording_id');a.add_argument('--language')
 a=sub.add_parser('source');a.add_argument('profile_id');a.add_argument('file',type=Path)
 a=sub.add_parser('character');a.add_argument('profile_id');a.add_argument('file',type=Path)
 a=sub.add_parser('expression');a.add_argument('pack',type=Path);a.add_argument('profile_id');a.add_argument('text');a.add_argument('--style',default='neutral')
 args=p.parse_args()
 if args.command is None:
  from .desktop import main as desktop
  return desktop(args.data_dir)
 enforce_offline()
 try:
  if args.command=='expression':result=VoiceLibrary(args.pack).expression_request(args.profile_id,args.text,args.style)
  elif args.command=='health':result=health(True)
  else:
   with ProjectLock(args.data_dir):
    s=Studio(args.data_dir)
    if args.command=='list':result={'profiles':s.profiles(),'recordings':s.records()}
    elif args.command=='demo':result=s.demo()
    elif args.command=='import':result=s.import_audio(args.file)
    elif args.command=='profile':result=s.new_profile(args.name)
    elif args.command=='analyze':result=s.analyze(args.recording_id,args.method,args.speakers)
    elif args.command=='bind':result=s.bind(args.recording_id,args.speaker,args.profile_id)
    elif args.command=='quality':result=s.audio_quality(args.recording_id,args.start,args.end,args.channel)
    elif args.command=='cleanup':result=s.save_audio_settings(args.recording_id,json.loads(args.file.read_text()))
    elif args.command=='export':print(s.export(args.profiles,args.encoding,args.quality_policy));return 0
    elif args.command=='transcribe':result=s.transcribe(args.recording_id,language=args.language)
    elif args.command=='source':result=s.import_source(args.profile_id,args.file.read_bytes(),args.file.name)
    elif args.command=='character':result=s.update_character(args.profile_id,json.loads(args.file.read_text()))
  print(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False));return 0
 except Exception as exc:print('Error: '+str(exc),file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
