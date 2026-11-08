"""Explicit generic multilingual formant speech, never a silent voice fallback."""
from pathlib import Path
import os,subprocess,json,hashlib,sys
from .runtime import APP_ROOT
from .languages import canonical,ESPEAK_VOICES
from . import audio
def render(text,language,rate,destination):
 language=canonical(language);root=APP_ROOT/'vendor/espeak-ng';executable=Path(os.environ.get('VOICE_STUDIO_ESPEAK_EXE',root/'espeak-ng.exe')).resolve();data=Path(os.environ.get('VOICE_STUDIO_ESPEAK_DATA',root)).resolve()
 if not executable.is_file() or not (data/'espeak-ng-data').is_dir():raise ValueError('Bundled generic speech executable or voice data is missing.')
 argv=[str(executable),'--path='+str(data),'-b','1','-v',ESPEAK_VOICES[language],'-s',str(round(175*rate)),'-w',str(Path(destination).resolve()),'--stdin']
 options={}
 if os.name=='nt':
  # Python's add_dll_directory handles do not propagate to child processes.
  # The private interpreter directory contains the unchanged VC runtime DLLs.
  options={'creationflags':subprocess.CREATE_NO_WINDOW,'cwd':str(executable.parent),'env':{**os.environ,'PATH':str(Path(sys.executable).resolve().parent)}}
 result=subprocess.run(argv,input=text.encode('utf-8'),capture_output=True,timeout=180,**options)
 if result.returncode:raise ValueError('Generic speech failed: '+result.stderr.decode('utf-8',errors='replace')[:2000])
 sr,samples=audio.read_audio(destination)
 return sr,audio.mono(samples),{'engine':'eSpeak NG 1.52.0','voice':ESPEAK_VOICES[language],'executable_sha256':hashlib.file_digest(executable.open('rb'),'sha256').hexdigest(),'bundled_asset_manifest':json.loads((root/'manifest.json').read_text()),'reference_conditioned':False,'character_imitation':False,'diagnostics':result.stderr.decode('utf-8',errors='replace')}
