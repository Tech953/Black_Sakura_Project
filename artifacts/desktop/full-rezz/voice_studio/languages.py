"""Independent offline locale and language-routing contracts."""
from dataclasses import dataclass,asdict
from pathlib import Path
import csv,json,re,os
LOCALES={'en':'English','es':'Español','fr':'Français','de':'Deutsch','pt':'Português','it':'Italiano','ru':'Русский','ja':'日本語','ko':'한국어','zh-Hans':'简体中文','ar':'العربية','hi':'हिन्दी'}
ESPEAK_VOICES={**{c:c for c in LOCALES},'zh-Hans':'cmn'}
HELP=[
 'Review anonymous clusters by listening. Clustering detects neither overlap nor character identity. Channel indices start at zero; blank means a mono mix.',
 'Processing is reversible. Preserve original audio; denoising requires a noise-only interval. JSON settings and diagnostic evidence remain in their original form.',
 'Keep unknown facts and source links. Tone and inflection depend on circumstance. Spectrum and pitch are separate. New archive dialogue is authored noncanon; source identity and history remain unchanged.',
 'Choose a local speech engine explicitly. Generation may take minutes. A spoken synthetic/archive label is added. Persona prompts and SSML do not directly control F5.',
 'F5 supports English and Mandarin reference conditioning. Generic speech is experimental for 12 languages and does not imitate a character. Arabic expects vocalized text; Japanese is preliminary. No automatic translation or engine fallback.',
 'Listen to the output and review all five ratings. Text and signal checks cannot approve likeness, pronunciation, naturalness or fidelity. Failed checks remain in history.',
 'Exports include reference clips, sources, transcripts, revisions and generation audio/audits. Editable backups retain originals. Restore only into an empty folder; uninstall preserves the separate workspace.',
 "Language settings are independent. The character companion generates local replies; Automatic asks it to follow the current request's language. Confirm ambiguous language in the host. The voice editor does not translate dialogue. Arabic is right-to-left; JSON, paths, hashes and source evidence stay unchanged."]
def canonical(value,automatic=False):
 if automatic and value in (None,'auto'):return 'auto'
 if not isinstance(value,str):raise ValueError('A language tag is required.')
 normalized={'zh':'zh-Hans','zh-cn':'zh-Hans','zh-hans':'zh-Hans'}.get(value.lower(),value.lower().split('-')[0])
 if normalized not in LOCALES:raise ValueError('Unsupported language tag: '+value)
 return normalized
@dataclass(frozen=True)
class LanguageSettings:
 interface_language:str='en'
 reply_language:str='auto'
 transcription_language:str='auto'
 synthesis_language:str='en'
 speech_engine:str='f5'
 def __post_init__(self):
  for k in ['interface_language','reply_language','transcription_language','synthesis_language']:object.__setattr__(self,k,canonical(getattr(self,k),k in ['reply_language','transcription_language']))
  if self.speech_engine not in ('f5','espeak'):raise ValueError('Unsupported speech engine.')
 def to_dict(self):return asdict(self)
 @classmethod
 def from_dict(cls,data):
  if not isinstance(data,dict):raise ValueError('Language settings must be an object.')
  return cls(**{k:data[k] for k in cls.__dataclass_fields__ if k in data})
 def transcription_code(self):return None if self.transcription_language=='auto' else ('zh' if self.transcription_language=='zh-Hans' else self.transcription_language)
 def reply_contract(self,user_language=None):
  resolved=canonical(user_language) if self.reply_language=='auto' and user_language else (None if self.reply_language=='auto' else self.reply_language)
  return {'requested_language':self.reply_language,'resolved_language':resolved,'automatic_policy':'follow_user_language' if self.reply_language=='auto' else None,'host_must_confirm_language':resolved is None,'translate_sources':False,'studio_generates_chat':False}
def synthesis_capability(language,engine='f5'):
 language=canonical(language)
 if engine not in ('f5','espeak'):raise ValueError('Unsupported speech engine.')
 return {'language':language,'engine':engine,'language_supported':engine=='espeak' or language in ('en','zh-Hans'),'reference_conditioned':engine=='f5','character_likeness_verified':False,'native_speaker_review_verified':False,'automatic_fallback':False,'quality':'reference-conditioned approximation' if engine=='f5' else 'experimental generic formant speech; no character imitation','limits':['Arabic expects vocalized text; Japanese is preliminary.'] if engine=='espeak' else ['Bundled F5 targets English and Mandarin; other language requests are refused.']}
def installer_locale():
 if os.name!='nt':return 'en'
 try:
  import winreg
  with winreg.OpenKey(winreg.HKEY_CURRENT_USER,'Software\\VoiceProfileStudio') as key:value=winreg.QueryValueEx(key,'InstallerLanguage')[0]
  return {'1033':'en','1034':'es','1036':'fr','1031':'de','2070':'pt','1040':'it','1049':'ru','1041':'ja','1042':'ko','2052':'zh-Hans','1025':'ar','1081':'hi'}.get(str(value),'en')
 except OSError:return 'en'
def read_settings(path):
 p=Path(path)
 if not p.exists():return {},LanguageSettings(interface_language=installer_locale())
 data=json.loads(p.read_text(encoding='utf-8'))
 if not isinstance(data,dict):raise ValueError('Settings must be an object.')
 return data,LanguageSettings.from_dict(data.get('languages',{}))
def save_settings(path,settings,workspace=None):
 from .engine import write_json
 data,_=read_settings(path);data['languages']={**data.get('languages',{}),**settings.to_dict()}
 if workspace is not None:data['workspace']=str(workspace)
 write_json(Path(path),data)
def catalogs():
 result={c:{} for c in LOCALES}
 for name in ['catalog.tsv','help.tsv']:
  with (Path(__file__).parent/'locales'/name).open(encoding='utf-8',newline='') as stream:
   reader=csv.DictReader(stream,delimiter='\t')
   if reader.fieldnames!=list(LOCALES):raise ValueError('Incorrect locale columns.')
   for row in reader:
    if None in row or any(not row.get(c) for c in LOCALES):raise ValueError('Incomplete translation: '+str(row.get('en')))
    placeholders=set(re.findall(r'\{\w+\}',row['en']))
    for code in LOCALES:
     if set(re.findall(r'\{\w+\}',row[code]))!=placeholders:raise ValueError('Placeholder mismatch.')
     result[code][row['en']]=row[code]
 result['en'].update(ready_for_listening_review='Ready for listening review',failed='Failed',interrupted='Interrupted',preparing='Preparing',generating='Generating')
 return result
class Localizer:
 def __init__(self,locale='en'):self.catalogs=catalogs();self.locale=canonical(locale)
 def text(self,source,**values):
  value=self.catalogs[self.locale].get(source,source)
  return value.format(**values) if values else value
 def guide(self):
  t=self.text;sections=['# FULL_REZZ 3.0 — '+t('User guide'),'',t(HELP[7])]
  entries=[('1 Audio & regions',HELP[0],['Import audio / video','Listen','Save edits','Bind selected speaker']),('2 Profile & sources',HELP[2],['New profile','Import local source','Draft from sources','Save profile revision']),('3 Generate',HELP[4],['Synthesis language','Speech engine','Generate test clip']),('4 Review & audit',HELP[5],['Listen reference','Listen generated','Recheck words','Append listening review']),('5 Export & backup',HELP[6],['Export all profile reference packs','Back up editable workspace','Restore backup into empty folder'])]
  for title,help_text,steps in entries:sections+=['','## '+t(title),'',t(help_text),'']+[f'{i}. {t(s)}' for i,s in enumerate(steps,1)]
  sections+=['','## '+t('Character companion'),'']+[f'{i}. {t(label)}' for i,label in enumerate(['Import chat log','Send and speak','2D authored views','3D surfaces','Open companion window','Export companion movie'],1)]
  sections+=['','FULL_REZZ companion: local replies are provided by the separate character companion module. See the bundled User_Guide.pdf for imports, rendering, speech and remaining acceptance gates.']
  sections+=['',t(HELP[1]),'',t('Technical details are retained in their original language.')]
  return '\n'.join(sections)+'\n'
