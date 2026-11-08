import traceback,os,ctypes
from pathlib import Path
try:
 from voice_studio.desktop import main
 raise SystemExit(main())
except Exception:
 p=Path(os.environ.get('LOCALAPPDATA',Path.home()))/'VoiceProfileStudio/startup_error.log';p.parent.mkdir(parents=True,exist_ok=True);p.write_text(traceback.format_exc())
 if os.name=='nt':ctypes.windll.user32.MessageBoxW(None,'Application startup failed. Details: '+str(p),'FULL_REZZ',16)
 else:raise
