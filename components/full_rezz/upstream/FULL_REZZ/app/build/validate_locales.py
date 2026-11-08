"""Native locale/RTL/glyph/data retention checks; no Windows execution claim."""
import os,sys,tempfile,json
from pathlib import Path
os.environ['QT_QPA_PLATFORM']='offscreen';root=Path(__file__).resolve().parents[1];sys.path.insert(0,str(root))
from PySide6.QtCore import Qt
from PySide6.QtGui import QRawFont
from PySide6.QtWidgets import QApplication,QLabel,QPushButton,QCheckBox
from voice_studio.desktop import Window
from voice_studio.languages import LOCALES,read_settings
app=QApplication([]);results=[]
with tempfile.TemporaryDirectory() as d:
 config=Path(d)/'settings.json';w=Window(Path(d)/'workspace',config);w.show();app.processEvents();w.character.setPlainText('{"text":"العربية 日本語 हिन्दी"}');character=w.character.toPlainText();w.speech.setPlainText('Keep authored dialogue: 中文 हिन्दी العربية');speech=w.speech.toPlainText();record=w.studio.record(w.rid());profile=w.studio.profile(w.pid())
 for field,code in [('reply_language','fr'),('transcription_language','ja'),('synthesis_language','hi'),('speech_engine','espeak')]:w.language_controls[field].setCurrentIndex(w.language_controls[field].findData(code))
 samples={'en':'Voice','es':'Español','fr':'Français','de':'Deutsch','pt':'Português','it':'Italiano','ru':'Русский','ja':'日本語','ko':'한국어','zh-Hans':'中文','ar':'العربية','hi':'हिन्दी'}
 for code in LOCALES:
  w.language_controls['interface_language'].setCurrentIndex(w.language_controls['interface_language'].findData(code));app.processEvents();assert w.tabs.count()==7
  assert w.layoutDirection()==(Qt.RightToLeft if code=='ar' else Qt.LeftToRight)
  for view in [w.character,w.audit_view,w.path_label]:assert view.layoutDirection()==Qt.LeftToRight
  assert w.character.toPlainText()==character and w.speech.toPlainText()==speech and w.studio.record(w.rid())==record and w.studio.profile(w.pid())==profile
  _,settings=read_settings(config);assert (settings.reply_language,settings.transcription_language,settings.synthesis_language,settings.speech_engine)==('fr','ja','hi','espeak')
  for rating in w.ratings.values():assert rating.currentData()=='unreviewed'
  assert w.policy.currentData()=='high_fidelity'
  for cls in [QLabel,QPushButton,QCheckBox]:
   for widget in w.findChildren(cls):
    source=widget.property('ui_source')
    if source:assert widget.text()==w.localizer.text(source)
  raw=QRawFont.fromFont(w.font());assert all(raw.supportsCharacter(ord(c)) for c in samples[code]),code+' glyph coverage'
  w.tabs.setCurrentIndex(6);app.processEvents();assert w.grab().save(str(root/'audit'/('locale-'+code+'.png')))
  results.append({'locale':code,'native_ui':True,'rtl':code=='ar','glyphs_verified':True,'settings_and_machine_codes_preserved':True,'source_and_unsaved_text_unchanged':True})
 w.language_controls['interface_language'].setCurrentIndex(w.language_controls['interface_language'].findData('ar'))
 for index in [0,2,3]:w.tabs.setCurrentIndex(index);app.processEvents();assert w.grab().save(str(root/'audit'/('arabic-tab-'+str(index)+'.png')))
 w.close()
result={'locales':results,'passed':len(results)==12,'actual_windows_execution_verified':False,'professional_translation_review':'pending'};(root/'audit/localization_ui.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print('All 12 native locale checks passed',flush=True)
