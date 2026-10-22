"""Local synthesis with append-only review and word-check history."""
import re,json,hashlib,math,time,shutil,unicodedata
from pathlib import Path
import numpy as np
from . import audio,quality,spectrum,models,research
from .engine import identifier,now,write_json
from .runtime import model_path,enforce_offline
from .sdk import VoiceLibrary
from .languages import canonical,synthesis_capability,LanguageSettings
from . import generic_speech
RATINGS=['likeness','naturalness','delivery','reference_purity','canon_boundaries']
DISCLOSURES={
 'en':('Non-canon archive simulation.','Synthetic voice test.'),
 'es':('Simulación de archivo no canónica.','Prueba de voz sintética.'),
 'fr':('Simulation d’archive non canonique.','Test de voix synthétique.'),
 'de':('Nichtkanonische Archivsimulation.','Test einer synthetischen Stimme.'),
 'pt':('Simulação de arquivo não canônica.','Teste de voz sintética.'),
 'it':('Simulazione di archivio non canonica.','Prova di voce sintetica.'),
 'ru':('Неканоническая архивная симуляция.','Тест синтетического голоса.'),
 'ja':('公式設定ではないアーカイブのシミュレーションです。','合成音声のテストです。'),
 'ko':('정사가 아닌 아카이브 시뮬레이션입니다.','합성 음성 테스트입니다.'),
 'zh-Hans':('非正史档案模拟。','合成声音测试。'),
 'ar':('مُحَاكَاةٌ أَرْشِيفِيَّةٌ غَيْرُ رَسْمِيَّةٍ.','اِخْتِبَارُ صَوْتٍ اِصْطِنَاعِيٍّ.'),
 'hi':('मूल कथा से अलग संग्रह सिमुलेशन।','संश्लेषित आवाज़ का परीक्षण।')}
def disclosure(language,posthumous=False):return DISCLOSURES[canonical(language)][0 if posthumous else 1]
def digest(p):return hashlib.file_digest(Path(p).open('rb'),'sha256').hexdigest()
def word_check(expected,actual,threshold=.20,language=None):
 cjk=language in ('zh','zh-Hans','ja');comparison_expected,comparison_actual=expected,actual;normalization=None
 if language in ('zh','zh-Hans'):
  from opencc import OpenCC
  converter=OpenCC('t2s');comparison_expected=''.join(converter.convert(c) for c in expected);comparison_actual=''.join(converter.convert(c) for c in actual);normalization='OpenCC 0.1.7 Traditional-to-Simplified per-character mapping; no phrase or slang replacement'
 def tokens(text):
  text=unicodedata.normalize('NFKC',text).casefold().replace('’',"'")
  if language=='ar':text=''.join(c for c in text if not (unicodedata.category(c).startswith('M') and 0x600<=ord(c)<=0x6ff))
  if cjk:return [c for c in text if c.isalnum()]
  words=[];current=''
  for i,c in enumerate(text):
   category=unicodedata.category(c)[0]
   if category in ('L','N') or (category=='M' and current):current+=c
   elif c=="'" and current and i+1<len(text) and unicodedata.category(text[i+1])[0] in ('L','N'):current+=c
   else:
    if current:words.append(current);current=''
  if current:words.append(current)
  return words
 a,b=tokens(comparison_expected),tokens(comparison_actual);row=list(range(len(b)+1))
 for i,x in enumerate(a,1):
  out=[i]
  for j,y in enumerate(b,1):out.append(min(out[-1]+1,row[j]+1,row[j-1]+(x!=y)))
  row=out
 errors=row[-1];rate=errors/max(len(a),1)
 return {'expected_text':expected,'transcribed_text':actual,'comparison_expected_text':comparison_expected,'comparison_transcribed_text':comparison_actual,'script_normalization':normalization,'word_errors':errors,'expected_word_count':len(a),'word_error_rate':None if cjk else rate,'character_error_rate':rate if cjk else None,'error_rate':rate,'metric':'CER' if cjk else 'WER','language':language,'threshold':threshold,'passed':bool(a) and rate<=threshold,'normalization':'NFKC characters' if cjk else 'NFKC Unicode words with combining marks; optional Arabic vocalization ignored; no slang replacement','limits':'Text agreement cannot approve pronunciation, likeness, purity, delivery or naturalness.'}
class RenderManager:
 def __init__(self,studio):self.studio=studio;self.root=studio.root/'generations';self.root.mkdir(exist_ok=True)
 def path(self,gid):
  if not re.fullmatch(r'gen_[a-f0-9]{16}',gid):raise ValueError('Invalid generation identifier.')
  p=(self.root/gid).resolve()
  if not p.is_relative_to(self.root.resolve()):raise ValueError("Generation path is outside the workspace.")
  if not (p/'audit.json').exists():raise ValueError('Generation not found.')
  return p
 def get(self,gid):return json.loads((self.path(gid)/'audit.json').read_text())
 def list(self):return sorted([json.loads(p.read_text()) for p in self.root.glob('gen_*/audit.json')],key=lambda a:a.get('created_at',''),reverse=True)
 def review(self,gid,ratings,notes=''):
  if set(ratings)!=set(RATINGS) or any(v not in ('unreviewed','acceptable','needs_revision') for v in ratings.values()):raise ValueError('Review all five dimensions using supported ratings.')
  a=self.get(gid);a['human_review']=dict(ratings);a.setdefault('review_history',[]).append({'at':now(),'ratings':dict(ratings),'notes':str(notes)[:10000]});write_json(self.path(gid)/'audit.json',a);return a
 def recheck(self,gid):
  p=self.path(gid);a=self.get(gid);file=p/'generated.wav'
  if not file.exists():raise ValueError('No delivered audio to check.')
  expected=next((i['sha256'] for i in a.get('files',[]) if i['name']=='generated.wav'),None)
  if expected and digest(file)!=expected:raise ValueError('Generated audio checksum changed.')
  sr,x=audio.read_audio(file);result=models.transcribe(x,sr,language=a.get('language'));text=' '.join(s['text'] for s in result['segments']);check=word_check(a['spoken_text'],text,language=a.get('language'));check.update(at=now(),model=result['model'],audio_sha256=digest(file));a.setdefault('word_check_history',[]).append(check);a['word_check']=check;write_json(p/'audit.json',a);return a
 def generate(self,pid,text,style='neutral',rate=1.,seed=20261008,steps=32,language='en',engine='f5',language_settings=None,disclosure_in_audio=True):
  enforce_offline()
  if not isinstance(text,str) or not 1<=len(text.strip())<=800:raise ValueError('Supply 1-800 characters.')
  if not isinstance(rate,(int,float)) or isinstance(rate,bool) or not math.isfinite(rate) or not .5<=rate<=1.5:raise ValueError('Rate must be 0.5-1.5.')
  if isinstance(seed,bool) or not isinstance(seed,int) or not 0<=seed<2**31:raise ValueError('Invalid seed.')
  if steps not in (16,32):raise ValueError('Use 16 or 32 sampling steps.')
  language=canonical(language);capability=synthesis_capability(language,engine);settings=LanguageSettings.from_dict(language_settings) if language_settings is not None else LanguageSettings(synthesis_language=language,speech_engine=engine)
  if settings.synthesis_language!=language or settings.speech_engine!=engine:raise ValueError('Conflicting synthesis language settings.')
  if not capability['language_supported']:raise ValueError('Selected speech engine does not support this language; no automatic fallback. Choose generic multilingual speech explicitly.')
  profile=self.studio.profile(pid);research.validate_character(profile['character'],{s['id'] for s in profile.get('sources',[])})
  posthumous=profile['character'].get('archive_contract',{}).get('emulation_mode')=='posthumous_archive'
  spoken=(disclosure(language,posthumous)+' ' if disclosure_in_audio else '')+text.strip()
  gid=identifier('gen');p=self.root/gid;p.mkdir();started=time.monotonic()
  a={'id':gid,'profile_id':pid,'profile_snapshot':profile,'created_at':now(),'status':'preparing','generation_performed':False,'spoken_text':spoken,'original_text':text,'requested_style':style,'language':language,'language_settings':settings.to_dict(),'language_capability':capability,'human_review':{k:'unreviewed' for k in RATINGS},'review_history':[],'word_check_history':[],'renderer':{'engine':'F5-TTS v1 Base / Vocos' if engine=='f5' else 'eSpeak NG 1.52.0','reference_conditioned':engine=='f5','device':'cpu','seed':seed,'steps':steps,'rate':rate,'remote_inference':False,'training':False},'limits':['Reference conditioning is an approximation; not an official or actor performance.','Persona/system prompts and SSML are not executed by F5.','Delivery depends on scene and reference; style is a selection hint.','All human ratings require listening.']}
  write_json(p/'audit.json',a)
  try:
   if engine=='f5':
    pack=self.studio.export([pid],'PCM16','standard');library=VoiceLibrary(pack.with_suffix(''));ref=library.reference(pid,style)
    if not ref['text'].strip():raise ValueError('Reference needs an exact reviewed transcript.')
    if not .2<=ref['duration_seconds']<=20:raise ValueError('Reference duration is unsupported.')
    source=Path(ref['absolute_path']);shutil.copy2(source,p/'reference_native.wav');sr,x=audio.read_audio(source);x=audio.mono(x);condition=np.r_[x,np.zeros(round(sr*.7),np.float32)];audio.write_audio(p/'conditioning_reference.wav',sr,condition,'PCM16')
    a['reference']=ref;a['source_record_snapshot']=self.studio.record(ref['recording_id']);a['model_manifest']=json.loads(model_path('manifest.json').read_text());a['status']='generating';write_json(p/'audit.json',a)
    import torch,torchaudio,functools
    torch.set_num_threads(4);torchaudio.load=functools.partial(torchaudio.load,backend='soundfile')
    from f5_tts.api import F5TTS
    renderer=F5TTS(model='F5TTS_v1_Base',ckpt_file=str(model_path('tts/model_1250000.safetensors')),vocab_file=str(model_path('tts/vocab.txt')),vocoder_local_path=str(model_path('vocos')),device='cpu')
    wav,out_sr,_=renderer.infer(ref_file=str(p/'conditioning_reference.wav'),ref_text=ref['text'],gen_text=spoken,seed=seed,nfe_step=steps,speed=rate,cfg_strength=2.,sway_sampling_coef=-1.,progress=None)
   else:
    a['status']='generating';a['renderer'].update(seed_used=False,sampling_steps_used=False,style_used=False,character_imitation=False);write_json(p/'audit.json',a)
    out_sr,wav,details=generic_speech.render(spoken,language,rate,p/'generic_original.wav');a['renderer'].update(details);a['model_manifest']=details['bundled_asset_manifest'];a['reference']=None;a['human_review_applicability']={'likeness':False,'reference_purity':False,'naturalness':True,'delivery':True,'canon_boundaries':True};sr=out_sr;x=wav
   y=np.asarray(wav,dtype=np.float32).reshape(-1)
   if not len(y) or not np.isfinite(y).all() or not .25<len(y)/out_sr<180:raise ValueError('Generated signal is invalid.')
   audio.write_audio(p/'raw_float32.wav',out_sr,y,'FLOAT32');peak=float(np.max(np.abs(y)));gain=10**(-3/20)/max(peak,1e-10)
   if gain>10**(12/20):raise ValueError('Generated signal is unexpectedly quiet.')
   z=y*gain;n=min(round(out_sr*.005),len(z)//2);z[:n]*=np.linspace(0,1,n,dtype=np.float32);z[-n:]*=np.linspace(1,0,n,dtype=np.float32);audio.write_audio(p/'generated.wav',out_sr,z,'PCM16');dsr,delivered=audio.read_audio(p/'generated.wav')
   a.update(status='ready_for_listening_review',generation_performed=True,duration_seconds=len(z)/out_sr,sample_rate_hz=out_sr,quality={'raw':quality.inspect(y,out_sr),'delivered':quality.inspect(delivered,dsr)},processing={'gain_db':20*math.log10(gain),'fade_ms':5,'pitch_shift':0,'eq':False},spectrum=spectrum.compare(spectrum.measure(x,sr),spectrum.measure(delivered,dsr)) if engine=='f5' else {'reference':None,'generated':spectrum.measure(delivered,dsr),'controlled_comparison':False,'spectral_agreement_verified':False},elapsed_seconds=time.monotonic()-started)
   a['files']=[{'name':f.name,'sha256':digest(f),'bytes':f.stat().st_size} for f in p.glob('*.wav')];write_json(p/'audit.json',a)
   try:a=self.recheck(gid)
   except Exception as exc:a['word_check_error']=str(exc);write_json(p/'audit.json',a)
   return a
  except Exception as exc:
   a.update(status='failed',error=str(exc),elapsed_seconds=time.monotonic()-started);write_json(p/'audit.json',a);raise
