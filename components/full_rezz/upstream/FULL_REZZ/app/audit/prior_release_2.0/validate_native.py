import sys,os,time,json,shutil
from pathlib import Path
os.environ['QT_QPA_PLATFORM']='offscreen';root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from voice_studio.desktop import Window,QApplication,QMessageBox
from voice_studio.engine import write_json
from voice_studio import models
app=QApplication([]);errors=[];QMessageBox.warning=lambda *a:errors.append(str(a[-1]));w=Window(root.parent/'native_validation_workspace_2');checks=[]
def check(name,value):
 if not value:raise AssertionError(name)
 checks.append({'name':name,'passed':True})
w.show();app.processEvents();check('six native tabs',w.tabs.count()==6);check('four recovered recordings',w.recordings.count()==4);check('historical generation present',w.generations.count()==1)
p=w.studio.profile(w.pid());c=p['character'];c['integration_custom_field']='preserved';w.character.setPlainText(json.dumps(c));w.save_profile();check('custom field retained',w.studio.profile(w.pid())['character']['integration_custom_field']=='preserved');check('profile history retained',bool(list((w.root/'profile_history'/w.pid()).glob('*.json'))));w.save_regions();check('record history retained',bool(list((w.studio.record_path(w.rid())/'history').glob('*.json'))));w.listen_record();check('PCM16 preview prepared',(w.root/'preview_pcm16.wav').is_file());w.save_review();a=w.renders.get(w.gid());check('review appended',bool(a['review_history']));check('failed historical word check retained',a['word_check_history'][0]['passed'] is False);check('ratings remain unreviewed',all(v=='unreviewed' for v in a['human_review'].values()))
# Anonymous clustering and separation are real local model calls with the optional
# ONNX engine blocked. No Windows execution or actual device playback is claimed.
sr,x=w.studio.samples(w.rid());r={'checks':[]}
for name,fn in [('transcription',lambda:models.transcribe(x,sr)),('anonymous_clustering',lambda:models.diarize(x,sr,1)),('separation',lambda:models.separate(x,sr,w.root/'unused'))]:
 started=time.monotonic()
 try:
  result=fn()
  if name=='separation':
   import numpy as np
   result={'sample_rate_hz':result[0],'shape':result[1].shape,'finite':bool(np.isfinite(result[1]).all()),'peak':float(np.max(np.abs(result[1]))),'identity_verified':False}
  r['checks'].append({'name':name,'passed':True,'seconds':time.monotonic()-started,'result':result})
 except Exception as exc:r['checks'].append({'name':name,'passed':False,'error':str(exc)})
 write_json(root/'audit/local_models.json',r)
w.job('generate',{'pid':w.pid(),'text':"Easy, choom. Big attitude, tiny patience. Now let's hear what you've got.",'style':'concern','rate':1.,'seed':20261007,'steps':32});start=time.monotonic()
while w.process is not None and time.monotonic()-start<600:app.processEvents();time.sleep(.05)
if w.process is not None:w.cancel();raise RuntimeError('Default generation timed out.')
if not w.result_path.exists():raise RuntimeError('Worker produced no result. Diagnostic: '+str(w.task_path.with_suffix('.log')))
result=json.loads(w.result_path.read_text());write_json(root/'audit/native_generation.json',{'native_QProcess':True,'result':result,'errors':errors,'windows_execution':False});check('native model worker completed',w.process is None);check('real generation performed',result['ok'] and result['result']['generation_performed']);a=result['result'];shutil.copytree(w.renders.path(a['id']),root/'example_workspace/generations'/a['id']);shutil.copy2(w.renders.path(a['id'])/'generated.wav',root.parent/'Voice_Profile_Studio_2.0.0_Noncanon_Test.wav')
for i in range(6):w.tabs.setCurrentIndex(i);app.processEvents();w.grab().save(str(root/'audit'/f'native-tab-{i+1}.png'))
check('six screenshot captures',len(list((root/'audit').glob('native-tab-*.png')))==6);write_json(root/'audit/native_ui.json',{'checks':checks,'passed':True,'actual_windows_execution':False,'playback_device_verified':False});w.close();print(json.dumps({'native_checks':len(checks),'generation':True,'word_check':a.get('word_check'),'duration_seconds':a['duration_seconds'],'elapsed_seconds':a['elapsed_seconds']}),flush=True)
