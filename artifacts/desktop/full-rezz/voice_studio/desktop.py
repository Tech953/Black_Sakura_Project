"""Native Qt Widgets application. No browser, HTTP server or Node runtime."""
import sys,os,json,shutil,zipfile,stat
from pathlib import Path
import numpy as np
from PySide6.QtCore import Qt,QProcess
from PySide6.QtWidgets import QApplication,QMainWindow,QWidget,QVBoxLayout,QHBoxLayout,QFormLayout,QLabel,QPushButton,QComboBox,QLineEdit,QPlainTextEdit,QTabWidget,QFileDialog,QMessageBox,QDoubleSpinBox,QSpinBox,QTableWidget,QTableWidgetItem,QTextBrowser,QCheckBox
from .runtime import APP_ROOT,workspace,enforce_offline
from .engine import Studio,identifier,write_json
from .project_lock import ProjectLock
from .synthesis import RenderManager,RATINGS
from . import audio,quality
from .languages import LanguageSettings,Localizer,LOCALES,HELP,read_settings,save_settings
from . import qt_locale

def pretty(v):return json.dumps(v,ensure_ascii=False,indent=2,allow_nan=False)
class Window(QMainWindow):
 def __init__(self,root,config=None):
  super().__init__();self.config=Path(config) if config else workspace().parent/'settings.json';_,self.settings=read_settings(self.config);self.localizer=Localizer(self.settings.interface_language);self.tab_sources=[];enforce_offline();self.process=None;self.setWindowTitle('FULL_REZZ 3.0 — Offline');self.resize(1280,900)
  self.setWindowTitle('FULL_REZZ 3.0 — Offline Character & Voice Studio')
  self.root=Path(root).resolve()
  if (APP_ROOT.parent/'python').exists() and self.root.is_relative_to(APP_ROOT.parent):raise ValueError('Choose a workspace outside the installed application.')
  if not (self.root/'profiles.json').exists() and (APP_ROOT/'example_workspace/profiles.json').exists():shutil.copytree(APP_ROOT/'example_workspace',self.root,dirs_exist_ok=True)
  self.project_lock=ProjectLock(self.root);self.studio=Studio(self.root);self.renders=RenderManager(self.studio)
  center=QWidget();self.setCentralWidget(center);layout=QVBoxLayout(center)
  header=QHBoxLayout();self.path_label=QLabel(str(self.root));header.addWidget(self.path_label,1);self.button(header,'Open workspace',self.choose_workspace);layout.addLayout(header)
  self.tabs=QTabWidget();layout.addWidget(self.tabs,1)
  self.audio_tab();self.profile_tab();self.generate_tab();self.review_tab();self.export_tab();self.guide_tab();self.language_tab();self.companion_tab();self.animation_review_tab()
  bar=QHBoxLayout();self.status=QLabel('Ready');bar.addWidget(self.status,1);self.cancel_button=self.button(bar,'Cancel operation',self.cancel);layout.addLayout(bar)
  self.log=QPlainTextEdit();self.log.setReadOnly(True);self.log.setMaximumHeight(100);layout.addWidget(self.log)
  self.refresh();qt_locale.apply(self)
 def button(self,layout,label,handler):
  b=QPushButton(label);b.setProperty('processing_sensitive',True);b.clicked.connect(lambda:self.guard(handler));layout.addWidget(b);return b
 def companion_tab(self):
  from full_rezz_companion.qt import CompanionWidget
  self.companion=CompanionWidget(self.studio,job_callback=self.job,settings_callback=lambda:self.settings.to_dict())
  self.tabs.addTab(self.companion,'Character companion');self.tab_sources.append('Character companion')
  h=QHBoxLayout();self.button(h,'Open companion window',self.open_companion);self.companion.layout().addLayout(h)
 def animation_review_tab(self):
  from full_rezz_companion.video_review import VideoReviewWidget
  self.video_review=VideoReviewWidget(APP_ROOT/'animation_review');self.tabs.addTab(self.video_review,'Animation comparison');self.tab_sources.append('Animation comparison')
 def open_companion(self):
  from full_rezz_companion.qt import CompanionWidget
  if getattr(self,'companion_window',None):self.companion_window.show();self.companion_window.raise_();return
  self.companion_window=CompanionWidget(self.studio,job_callback=self.job,settings_callback=lambda:self.settings.to_dict())
  from full_rezz_companion.qt import apply_widget_locale
  apply_widget_locale(self.companion_window,self.localizer);self.companion_window.setFont(self.font());self.companion_window.setWindowTitle('FULL_REZZ — '+self.localizer.text('Character companion'));self.companion_window.resize(1280,850);self.companion_window.show()
 def guard(self,fn):
  try:fn()
  except Exception as exc:self.show_error('Operation could not complete',str(exc))
 def page(self,name):
  w=QWidget();v=QVBoxLayout(w);self.tabs.addTab(w,name);self.tab_sources.append(name);return v
 def combo(self,layout):c=QComboBox();layout.addWidget(c);return c
 def number(self,minimum=0,maximum=1800,value=0):
  n=QDoubleSpinBox();n.setRange(minimum,maximum);n.setDecimals(3);n.setValue(value);return n
 def rid(self):
  rid=self.recordings.currentData()
  if not rid:raise ValueError('Import or select a recording first.')
  return rid
 def pid(self,combo=None):
  pid=(combo or self.profiles).currentData()
  if not pid:raise ValueError('Create or select a profile first.')
  return pid
 def audio_tab(self):
  v=self.page('1 Audio & regions');h=QHBoxLayout();self.recordings=self.combo(h);self.button(h,'Import audio / video',self.import_audio);v.addLayout(h);self.recordings.currentIndexChanged.connect(self.load_record)
  h=QHBoxLayout();self.method=self.combo(h);self.method.addItem('One declared reference voice','reference');self.method.addItem('Per-channel activity','channels');self.method.addItem('Anonymous speaker clusters','pyannote');h.addWidget(QLabel('Speakers (0 = automatic)'));self.count=QSpinBox();self.count.setRange(0,20);h.addWidget(self.count);self.button(h,'Analyze',lambda:self.job('analyze',{'rid':self.rid(),'method':self.method.currentData(),'count':self.count.value() or None}));self.button(h,'Transcribe',lambda:self.job('transcribe',{'rid':self.rid(),'language':self.settings.transcription_code()}));v.addLayout(h)
  v.addWidget(QLabel(HELP[0]))
  self.region_headers=['Start','End','Speaker','Channel','Purity','Delivery / scene','Exact spoken text'];self.regions=QTableWidget(0,7);self.regions.setHorizontalHeaderLabels(self.region_headers);self.regions.horizontalHeader().setStretchLastSection(True);v.addWidget(self.regions,1)
  h=QHBoxLayout();self.button(h,'Add region',self.add_region);self.button(h,'Remove selected',self.remove_region);self.button(h,'Save edits',self.save_regions);self.binding=self.combo(h);self.button(h,'Bind selected speaker',self.bind);v.addLayout(h)
  h=QHBoxLayout();h.addWidget(QLabel('Excerpt:'));self.start=self.number();self.end=self.number(value=4);h.addWidget(self.start);h.addWidget(self.end);self.channel=QSpinBox();self.channel.setRange(-1,7);self.channel.setValue(-1);h.addWidget(QLabel('Channel (-1 = mix)'));h.addWidget(self.channel);self.processed=QCheckBox('Conditioned preview');h.addWidget(self.processed);self.button(h,'Listen',self.listen_record);self.button(h,'Quality & spectrum',lambda:self.job('quality',self.excerpt()));self.button(h,'Separate two sources',lambda:self.job('separate',{k:x for k,x in self.excerpt().items() if k!='channel'}));v.addLayout(h)
  v.addWidget(QLabel(HELP[1]))
  self.cleanup=QPlainTextEdit();self.cleanup.setMaximumHeight(125);v.addWidget(self.cleanup);self.button(v,'Save processing settings',self.save_cleanup)
 def profile_tab(self):
  v=self.page('2 Profile & sources');h=QHBoxLayout();self.profiles=self.combo(h);self.button(h,'New profile',self.new_profile);v.addLayout(h);self.profiles.currentIndexChanged.connect(self.load_profile)
  f=QFormLayout();self.profile_name=QLineEdit();self.language=QLineEdit();self.notes=QLineEdit();f.addRow('Name',self.profile_name);f.addRow('Language hint',self.language);f.addRow('Notes',self.notes);v.addLayout(f)
  v.addWidget(QLabel(HELP[2]))
  self.character=QPlainTextEdit();v.addWidget(self.character,1);h=QHBoxLayout();self.button(h,'Save profile revision',self.save_profile);self.button(h,'Import local source',self.import_source);self.button(h,'Draft from sources',lambda:self.job('draft',{'pid':self.pid()}));self.button(h,'Apply last reviewed draft',self.apply_draft);v.addLayout(h)
  h=QHBoxLayout();self.sources=self.combo(h);self.button(h,'Read source',self.read_source);v.addLayout(h)
 def generate_tab(self):
  v=self.page('3 Generate');v.addWidget(QLabel(HELP[3]))
  f=QFormLayout();self.gen_profile=QComboBox();self.style=QLineEdit('neutral');self.rate=self.number(.5,1.5,1);self.seed=QSpinBox();self.seed.setRange(0,2147483647);self.seed.setValue(20261008);self.steps=QComboBox();self.steps.addItems(['32','16']);f.addRow('Profile',self.gen_profile);f.addRow('Scene / reference style',self.style);f.addRow('Rate multiplier',self.rate);f.addRow('Seed',self.seed);f.addRow('Sampling steps',self.steps);v.addLayout(f)
  self.speech=QPlainTextEdit();self.speech.setPlaceholderText('Enter 1–800 characters of authored dialogue.');v.addWidget(self.speech,1);self.button(v,'Generate test clip',lambda:self.job('generate',{'pid':self.pid(self.gen_profile),'text':self.speech.toPlainText(),'style':self.style.text(),'rate':self.rate.value(),'seed':self.seed.value(),'steps':int(self.steps.currentText()),'language':self.settings.synthesis_language,'engine':self.settings.speech_engine,'language_settings':self.settings.to_dict()}))
  v.addWidget(QLabel(HELP[4]))
 def review_tab(self):
  v=self.page('4 Review & audit');self.generations=self.combo(v);self.generations.currentIndexChanged.connect(self.load_generation);h=QHBoxLayout();self.button(h,'Listen generated',lambda:self.listen_generation('generated.wav'));self.listen_reference_button=self.button(h,'Listen reference',lambda:self.listen_generation('reference_native.wav'));self.button(h,'Save WAV',self.save_wav);self.button(h,'Recheck words',lambda:self.job('recheck',{'gid':self.gid()}));v.addLayout(h)
  self.audit_view=QPlainTextEdit();self.audit_view.setReadOnly(True);v.addWidget(self.audit_view,1);f=QFormLayout();self.ratings={}
  for name in RATINGS:
   c=QComboBox();[c.addItem(code,code) for code in ['unreviewed','acceptable','needs_revision']];self.ratings[name]=c;f.addRow(name.replace('_',' ').title(),c)
  v.addLayout(f);self.review_notes=QLineEdit();self.review_notes.setPlaceholderText('Listening observations, scene, changes requested');v.addWidget(self.review_notes);self.button(v,'Append listening review',self.save_review)
 def export_tab(self):
  v=self.page('5 Export & backup');self.encoding=self.combo(v);self.encoding.addItems(['FLOAT32','PCM24','PCM16']);self.policy=self.combo(v);[self.policy.addItem(code,code) for code in ['high_fidelity','standard']];self.button(v,'Export all profile reference packs',lambda:self.job('export',{'encoding':self.encoding.currentText(),'policy':self.policy.currentData()}));self.button(v,'Back up editable workspace',self.backup);self.button(v,'Restore backup into empty folder',self.restore);self.button(v,'Verify bundled model hashes',lambda:self.job('health',{}));v.addWidget(QLabel(HELP[6]));v.addStretch()
 def guide_tab(self):
  v=self.page('User guide');self.guide_browser=QTextBrowser();v.addWidget(self.guide_browser)
 def fill_profiles(self,c,profiles):
  current=c.currentData();c.blockSignals(True);c.clear()
  for p in profiles:c.addItem(p['name'],p['id'])
  idx=c.findData(current)
  if idx>=0:c.setCurrentIndex(idx)
  c.blockSignals(False)
 def language_tab(self):
  v=self.page('Language settings');f=QFormLayout();self.language_controls={}
  for field,label in [('interface_language','Interface language'),('reply_language','Reply language'),('transcription_language','Transcription language'),('synthesis_language','Synthesis language')]:
   combo=QComboBox()
   if field in ('reply_language','transcription_language'):combo.addItem('Automatic','auto')
   for code,name in LOCALES.items():combo.addItem(name,code)
   combo.setCurrentIndex(combo.findData(getattr(self.settings,field)));self.language_controls[field]=combo;f.addRow(label,combo)
  engine=QComboBox();engine.addItem('Reference-conditioned voice','f5');engine.addItem('Generic multilingual voice','espeak');engine.setCurrentIndex(engine.findData(self.settings.speech_engine));self.language_controls['speech_engine']=engine;f.addRow('Speech engine',engine);v.addLayout(f);v.addWidget(QLabel(HELP[7]));v.addStretch()
  for combo in self.language_controls.values():combo.currentIndexChanged.connect(self.change_languages)
 def change_languages(self):
  self.settings=LanguageSettings(**{k:c.currentData() for k,c in self.language_controls.items()});save_settings(self.config,self.settings,self.root);qt_locale.apply(self)
  if getattr(self,'companion_window',None):
   from full_rezz_companion.qt import apply_widget_locale
   apply_widget_locale(self.companion_window,self.localizer);self.companion_window.setFont(self.font())
 def show_error(self,title,details):
  dialog=QMessageBox(self);dialog.setIcon(QMessageBox.Warning);dialog.setWindowTitle(self.localizer.text(title));dialog.setText(self.localizer.text(title));dialog.setInformativeText(self.localizer.text('Technical details are retained in their original language.'));dialog.setDetailedText(details);dialog.exec()
 def operation_label(self,op):
  labels={'import':'Import audio / video','analyze':'Analyze','transcribe':'Transcribe','separate':'Separate two sources','quality':'Quality & spectrum','source':'Import local source','draft':'Draft from sources','generate':'Generate test clip','recheck':'Recheck words','export':'Export all profile reference packs','health':'Verify bundled model hashes','backup':'Back up editable workspace'}
  return self.localizer.text(labels.get(op,op))
 def refresh(self):
  previous=self.recordings.currentData();self.recordings.blockSignals(True);self.recordings.clear()
  for r in self.studio.records():self.recordings.addItem(f"{r['name']} · {r['duration']:.2f}s",r['id'])
  idx=self.recordings.findData(previous)
  if idx>=0:self.recordings.setCurrentIndex(idx)
  self.recordings.blockSignals(False)
  profiles=self.studio.profiles()
  for c in [self.profiles,self.binding,self.gen_profile]:self.fill_profiles(c,profiles)
  self.generations.blockSignals(True);gid=self.generations.currentData();self.generations.clear()
  for g in self.renders.list():self.generations.addItem(g['id']+' · '+self.localizer.text(g['status']),g['id'])
  idx=self.generations.findData(gid)
  if idx>=0:self.generations.setCurrentIndex(idx)
  self.generations.blockSignals(False);self.load_record();self.load_profile();self.load_generation()
  if getattr(self,'companion',None):self.companion.refresh()
  if getattr(self,'companion_window',None):self.companion_window.refresh()
 def load_record(self):
  if not self.recordings.currentData():return
  r=self.studio.record(self.rid());self.region_ids=[s['id'] for s in r['segments']];self.record_revision=r['revision'];self.regions.setRowCount(len(r['segments']))
  for i,s in enumerate(r['segments']):
   for j,key in enumerate(['start','end','speaker','channel','purity','style','text']):self.regions.setItem(i,j,QTableWidgetItem('' if s[key] is None else str(s[key])))
  self.cleanup.setPlainText(pretty(r.get('audio_processing',quality.DEFAULT_PROCESSING)));self.end.setValue(min(4,r['duration']));self.log.setPlainText(pretty({'recording':r['id'],'quality':r.get('quality'),'analysis':r.get('analysis'),'transcription':r.get('transcription')}))
 def load_profile(self):
  if not self.profiles.currentData():return
  p=self.studio.profile(self.pid());self.profile_revision=p.get('revision',0);self.profile_name.setText(p['name']);self.notes.setText(p['notes']);self.language.setText(p['language']);self.character.setPlainText(pretty(p['character']));self.sources.clear()
  for s in p.get('sources',[]):self.sources.addItem(s['title'],s['id'])
 def load_generation(self):
  if not self.generations.currentData():return
  a=self.renders.get(self.gid());self.listen_reference_button.setEnabled((self.renders.path(self.gid())/'reference_native.wav').is_file());self.audit_view.setPlainText(pretty(a))
  for k,c in self.ratings.items():c.setCurrentIndex(c.findData(a.get('human_review',{}).get(k,'unreviewed')))
 def add_region(self):
  i=self.regions.rowCount();self.regions.insertRow(i);self.region_ids.append(None)
  for j,x in enumerate([str(self.start.value()),str(self.end.value()),'VOICE_01','','unreviewed','neutral','']):self.regions.setItem(i,j,QTableWidgetItem(x))
 def remove_region(self):
  i=self.regions.currentRow()
  if i>=0:self.regions.removeRow(i);self.region_ids.pop(i)
 def save_regions(self):
  rows=[]
  for i in range(self.regions.rowCount()):
   values=[self.regions.item(i,j).text() if self.regions.item(i,j) else '' for j in range(7)];a,b,s,c,p,t,txt=values;rows.append({'id':self.region_ids[i],'start':float(a),'end':float(b),'speaker':s,'channel':int(c) if c.strip() else None,'purity':p,'style':t,'text':txt})
  self.studio.save_segments(self.rid(),rows,self.record_revision);self.refresh()
 def bind(self):
  i=self.regions.currentRow()
  if i<0:raise ValueError('Select a region for its speaker label.')
  self.studio.bind(self.rid(),self.regions.item(i,2).text(),self.pid(self.binding),self.record_revision);self.refresh()
 def excerpt(self):return {'rid':self.rid(),'start':self.start.value(),'end':self.end.value(),'channel':None if self.channel.value()<0 else self.channel.value()}
 def save_cleanup(self):self.studio.save_audio_settings(self.rid(),json.loads(self.cleanup.toPlainText()),self.record_revision);self.refresh()
 def save_profile(self):self.studio.update_character(self.pid(),json.loads(self.character.toPlainText()),self.profile_name.text(),self.notes.text(),self.language.text(),self.profile_revision);self.refresh()
 def new_profile(self):
  from PySide6.QtWidgets import QInputDialog
  name,ok=QInputDialog.getText(self,self.localizer.text('New profile'),self.localizer.text('Voice name:'))
  if ok:self.studio.new_profile(name);self.refresh()
 def import_audio(self):
  p,_=QFileDialog.getOpenFileName(self,self.localizer.text('Import audio or video'))
  if p:self.job('import',{'path':p})
 def import_source(self):
  p,_=QFileDialog.getOpenFileName(self,self.localizer.text('Import local character source'))
  if p:self.job('source',{'pid':self.pid(),'path':p})
 def read_source(self):
  if not self.sources.currentData():raise ValueError('Select an attached source.')
  self.show_result(self.studio.source_text(self.pid(),self.sources.currentData()))
 def apply_draft(self):
  if not getattr(self,'last_draft',None) or self.last_draft['profile_id']!=self.pid():raise ValueError('Generate and review a draft for this profile first.')
  self.studio.update_character(self.pid(),self.last_draft['character'],expected_revision=self.last_draft['base_revision']);self.refresh()
 def gid(self):
  gid=self.generations.currentData()
  if not gid:raise ValueError('Generate or select a clip first.')
  return gid
 def play(self,p):
  sr,x=audio.read_audio(p);x=audio.mono(x);peak=float(np.max(np.abs(x))) if len(x) else 0
  if peak>.9:x=x*(.9/peak)
  target=self.root/'preview_pcm16.wav';audio.write_audio(target,sr,x,'PCM16')
  if os.name!='nt':self.log.appendPlainText('PCM16 playback file prepared. Actual playback is supported by the Windows application.');return
  import winsound
  winsound.PlaySound(str(target),winsound.SND_FILENAME|winsound.SND_ASYNC)
 def listen_record(self):
  a=self.excerpt();content=self.studio.preview(a['rid'],a['start'],a['end'],a['channel'],self.processed.isChecked());p=self.root/'preview_float32.wav';p.write_bytes(content);self.play(p)
 def listen_generation(self,name):self.play(self.renders.path(self.gid())/name)
 def save_wav(self):
  source=self.renders.path(self.gid())/'generated.wav'
  if not source.exists():raise ValueError('This generation has no delivered WAV.')
  p,_=QFileDialog.getSaveFileName(self,self.localizer.text('Save test clip'),'Synthetic_Noncanon_Test.wav','WAV (*.wav)')
  if p and Path(p).resolve()!=source.resolve():shutil.copy2(source,p)
 def save_review(self):self.renders.review(self.gid(),{k:c.currentData() for k,c in self.ratings.items()},self.review_notes.text());self.load_generation()
 def backup(self):
  p,_=QFileDialog.getSaveFileName(self,self.localizer.text('Save editable workspace backup'),'Voice_Profile_Backup.zip','ZIP (*.zip)')
  if p:self.job('backup',{'path':p})
 def restore(self):
  source,_=QFileDialog.getOpenFileName(self,self.localizer.text('Select workspace backup'),'','ZIP (*.zip)')
  if not source:return
  destination=QFileDialog.getExistingDirectory(self,self.localizer.text('Select an empty destination'))
  if not destination:return
  root=Path(destination).resolve()
  if any(root.iterdir()):raise ValueError('Restore into an empty folder.')
  with zipfile.ZipFile(source) as z:
   if sum(i.file_size for i in z.infolist())>8*1024**3:raise ValueError('Backup exceeds the 8 GiB restore limit.')
   if 'profiles.json' not in z.namelist():raise ValueError('Not an editable workspace backup.')
   for i in z.infolist():
    if '\\' in i.filename or ':' in i.filename or not (root/i.filename).resolve().is_relative_to(root) or stat.S_ISLNK(i.external_attr>>16):raise ValueError('Unsafe backup member.')
   z.extractall(root)
  self.log.appendPlainText(self.localizer.text('Open workspace')+': '+str(root))
 def show_result(self,value):
  dialog=QMessageBox(self);dialog.setWindowTitle(self.localizer.text('Operation result'));dialog.setText(self.localizer.text(HELP[5]));dialog.setDetailedText(pretty(value));dialog.exec();self.log.setPlainText(pretty(value))
 def job(self,op,args):
  if self.process is not None:raise ValueError('One processing task at a time.')
  jobs=self.root/'jobs';jobs.mkdir(exist_ok=True);tid=identifier('job');self.task_path=jobs/(tid+'.json');self.result_path=jobs/(tid+'_result.json');self.operation=op
  args=dict(args)
  if op in ('companion_reply','companion_speech'):args.setdefault('settings',{})['job_id']=tid
  write_json(self.task_path,{'workspace':str(self.root),'operation':op,'args':args,'result_path':str(self.result_path)})
  process=QProcess(self);self.process=process;process.setWorkingDirectory(str(APP_ROOT));process.setProcessChannelMode(QProcess.MergedChannels);process.readyReadStandardOutput.connect(self.read_process);process.finished.connect(self.finished);process.errorOccurred.connect(self.process_error)
  executable=str(Path(sys.executable).with_name('python.exe')) if os.name=='nt' else sys.executable
  self.worker_log='';self.processing_buttons=[]
  for button in self.tabs.findChildren(QPushButton):
   if button.property('processing_sensitive') and button.isEnabled():self.processing_buttons.append(button);button.setEnabled(False)
  self.status.setText(self.localizer.text('Processing {operation} locally…',operation=self.operation_label(op)));self.log.clear();process.start(executable,['-m','voice_studio.worker',str(self.task_path)])
 def read_process(self):
  if self.process:
   text=bytes(self.process.readAllStandardOutput()).decode('utf-8',errors='replace');self.worker_log=getattr(self,'worker_log','')+text;self.log.appendPlainText(text)
 def process_error(self,error):
  if error==QProcess.FailedToStart:self.log.appendPlainText(self.localizer.text('Worker could not start.'));self.finished(-1,None)
 def finished(self,*args):
  if self.process is None:return
  self.read_process();self.task_path.with_suffix('.log').write_text(getattr(self,'worker_log',''),encoding='utf-8');self.process.deleteLater();self.process=None
  for button in getattr(self,'processing_buttons',[]):button.setEnabled(True)
  self.status.setText(self.localizer.text('Ready'))
  if self.result_path.exists():
   r=json.loads(self.result_path.read_text());self.refresh();self.log.setPlainText(pretty(r))
   if not r['ok']:self.show_error('Processing failed',r['error'])
   elif self.operation=='draft':self.last_draft=r['result'];self.show_result(r['result'])
   elif self.operation=='quality':self.show_result(r['result'])
   elif self.operation.startswith('companion_'):
    self.companion.handle_result(self.operation,r['result'])
    if getattr(self,'companion_window',None):self.companion_window.handle_result(self.operation,r['result'])
   elif self.operation=='export':
    p,_=QFileDialog.getSaveFileName(self,self.localizer.text('Save exported reference pack'),'Voice_Reference_Pack.zip','ZIP (*.zip)')
    if p and Path(p).resolve()!=Path(r['result']['path']).resolve():shutil.copy2(r['result']['path'],p)
  else:
   if self.operation.startswith('companion_'):self.companion.session.history.interrupt_job(self.task_path.stem)
   for a in self.renders.list():
    if a['status'] in ('preparing','generating'):a['status']='interrupted';write_json(self.renders.path(a['id'])/'audit.json',a)
   self.refresh();self.log.appendPlainText(self.localizer.text('Task interrupted. Partial generation evidence is retained.'))
 def cancel(self):
  if self.process:self.process.kill()
 def choose_workspace(self):
  if self.process:raise ValueError('Finish or cancel processing before changing workspace.')
  p=QFileDialog.getExistingDirectory(self,self.localizer.text('Open workspace'))
  if p:
   self.next_workspace=p;self.close()
 def closeEvent(self,event):
  if self.process:self.process.kill();self.process.waitForFinished(3000)
  save_settings(self.config,self.settings,self.root);
  for translator in getattr(self,'_qt_translators',[]):QApplication.instance().removeTranslator(translator)
  if getattr(self,'companion_window',None):self.companion_window.close()
  if getattr(self,'companion',None):self.companion.stop_audio();self.companion.timer.stop()
  for player in self.video_review.players:player.stop()
  self.project_lock.close();event.accept()
def main(root=None):
 app=QApplication.instance() or QApplication(sys.argv);config=workspace().parent/'settings.json';config.parent.mkdir(parents=True,exist_ok=True)
 if root is None:
  try:root=json.loads(config.read_text())['workspace']
  except Exception:root=workspace().parent if (workspace().parent/'profiles.json').exists() else workspace()
 while True:
  w=Window(root,config);w.show();app.exec()
  root=getattr(w,'next_workspace',None)
  if root is None:save_settings(config,w.settings,w.root);return 0
