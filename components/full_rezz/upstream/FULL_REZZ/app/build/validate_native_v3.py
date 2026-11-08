"""Real updated native worker generation; Windows execution remains unverified."""
import sys,os,json,time,shutil
from pathlib import Path
os.environ['QT_QPA_PLATFORM']='offscreen';root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from voice_studio.desktop import Window,QApplication
from voice_studio.engine import write_json
app=QApplication([]);destination=root.parent/'native_validation_v3';w=Window(destination,root.parent/'native_v3_settings.json');errors=[];w.show_error=lambda title,detail:errors.append({'title':title,'detail':detail});w.show();app.processEvents();results=[]
for language,text in [('en',"Easy, choom. Big attitude, tiny patience. Now let's hear what you've got."),('zh-Hans','这是中文声音测试。请检查清晰度。')]:
 w.language_controls['synthesis_language'].setCurrentIndex(w.language_controls['synthesis_language'].findData(language));w.speech.setPlainText(text)
 w.job('generate',{'pid':w.pid(w.gen_profile),'text':w.speech.toPlainText(),'style':'concern','rate':1.,'seed':20261007,'steps':32,'language':w.settings.synthesis_language,'engine':w.settings.speech_engine,'language_settings':w.settings.to_dict()})
 start=time.monotonic()
 while w.process is not None and time.monotonic()-start<720:app.processEvents();time.sleep(.05)
 if w.process is not None:w.cancel();raise RuntimeError('Native generation timeout')
 if not w.result_path.exists():raise RuntimeError('No native result; worker log retained')
 result=json.loads(w.result_path.read_text());assert result['ok'],result.get('error');a=result['result'];assert a['generation_performed'] and a['language']==language
 shutil.copytree(w.renders.path(a['id']),root/'example_workspace/generations'/a['id'],dirs_exist_ok=True);results.append({'language':language,'native_QProcess':True,'generation_performed':True,'generation_id':a['id'],'seconds':a['elapsed_seconds'],'word_check':a.get('word_check'),'all_ratings_unreviewed':all(v=='unreviewed' for v in a['human_review'].values())});write_json(root/'audit/native_generation_v3.json',{'renders':results,'errors':errors,'actual_windows_execution':False});print(json.dumps(results[-1],ensure_ascii=False),flush=True)
w.close()
