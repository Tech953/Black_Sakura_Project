"""Native shared companion widget with GPU surface rendering and sample-clock speech."""
from __future__ import annotations
import csv,ctypes,json,math,time,wave,uuid
from pathlib import Path
import numpy as np
from PySide6.QtCore import Qt,QTimer,QElapsedTimer,QByteArray,QBuffer,QIODevice,Signal
from PySide6.QtGui import QColor,QImage,QPainter,QPainterPath,QSurfaceFormat,QOpenGLContext,QOffscreenSurface
from PySide6.QtWidgets import QWidget,QVBoxLayout,QHBoxLayout,QFormLayout,QLabel,QPushButton,QComboBox,QPlainTextEdit,QSplitter,QStackedWidget,QDoubleSpinBox,QFileDialog,QMessageBox,QInputDialog,QDialog,QDialogButtonBox
from PySide6.QtOpenGLWidgets import QOpenGLWidget
from PySide6.QtMultimedia import QAudioFormat,QAudioSink,QMediaDevices
from .session import ConversationSession
from .characters import local_path
from .gltf import SurfaceModel
from .performance import PerformanceController,camera_matrix,benchmark_shots

VERTEX='''#version 330 core
layout(location=0) in vec3 position;
layout(location=1) in vec3 normal;
layout(location=2) in vec2 uv;
uniform mat4 mvp;
out vec3 n;out vec2 texcoord;
void main(){gl_Position=mvp*vec4(position,1.0);n=normal;texcoord=uv;}
'''
FRAGMENT='''#version 330 core
in vec3 n;in vec2 texcoord;
uniform vec4 colour;uniform sampler2D albedo;uniform int textured;uniform int alpha_mode;uniform float cutoff;
out vec4 result;
void main(){vec4 c=colour;if(textured==1)c*=texture(albedo,texcoord);
if(alpha_mode==1&&c.a<cutoff)discard;if(alpha_mode==0)c.a=1.0;
vec3 normal=normalize(n);float light=max(0.0,dot(normal,normalize(vec3(-0.4,0.8,0.6))));
float shade=0.32+0.68*floor(light*3.0)/3.0;
result=vec4(c.rgb*shade+max(0.0,1.0-normal.z)*vec3(0.025,0.045,0.065),c.a);}
'''

class SurfaceViewport(QOpenGLWidget):
    availability=Signal(bool,str)
    def __init__(self,parent=None):
        super().__init__(parent);f=QSurfaceFormat();f.setVersion(3,3);f.setProfile(QSurfaceFormat.CoreProfile);f.setDepthBufferSize(24);f.setSamples(4);self.setFormat(f)
        self.model=None;self.joints={};self.camera=benchmark_shots()[0].copy();self.animation_time=0.;self.energy=0.;self.action='idle';self.clip=None
        self.resources=[];self.program=None;self.ready=False;self.error='';self.paint_times=[];self.paint_intervals=[];self.last_paint=None;self.paint_count=0
        self.setMinimumSize(360,360)
    def set_model(self,model,joints):
        self.model=model;self.joints=joints;self.pending_upload=True;self.update()
    def initializeGL(self):
        try:
            from OpenGL import GL as gl
            from OpenGL.GL.shaders import compileProgram,compileShader
            self.gl=gl;self.program=compileProgram(compileShader(VERTEX,gl.GL_VERTEX_SHADER),compileShader(FRAGMENT,gl.GL_FRAGMENT_SHADER))
            self.vao=gl.glGenVertexArrays(1);gl.glBindVertexArray(self.vao);gl.glEnable(gl.GL_DEPTH_TEST);gl.glClearColor(14/255,22/255,31/255,1)
            self.ready=True;self.pending_upload=True;self.availability.emit(True,'OpenGL surfaces, depth, skinning and textures ready.')
            if self.context():self.context().aboutToBeDestroyed.connect(self.cleanup)
        except Exception as exc:self.error=str(exc);self.ready=False;self.availability.emit(False,'3D backend unavailable: '+str(exc))
    def cleanup(self):
        if not getattr(self,'gl',None):return
        self.makeCurrent();self.clear_resources()
        if self.program:self.gl.glDeleteProgram(self.program);self.program=None
        if getattr(self,'vao',None):self.gl.glDeleteVertexArrays(1,[self.vao]);self.vao=None
        self.doneCurrent();self.ready=False
    def clear_resources(self):
        for r in self.resources:
            self.gl.glDeleteBuffers(2,[r['vbo'],r['ibo']])
            if r['texture']:self.gl.glDeleteTextures([r['texture']])
        self.resources=[]
    def upload(self):
        self.clear_resources();gl=self.gl
        for p in self.model.primitives:
            vbo,ibo=gl.glGenBuffers(2);gl.glBindBuffer(gl.GL_ELEMENT_ARRAY_BUFFER,ibo);faces=np.ascontiguousarray(p['faces'].reshape(-1),np.uint32);gl.glBufferData(gl.GL_ELEMENT_ARRAY_BUFFER,faces.nbytes,faces,gl.GL_STATIC_DRAW)
            tex=0
            if p['texture'] is not None:
                tex=gl.glGenTextures(1);gl.glBindTexture(gl.GL_TEXTURE_2D,tex);rgba=np.ascontiguousarray(p['texture']);gl.glTexImage2D(gl.GL_TEXTURE_2D,0,gl.GL_RGBA8,rgba.shape[1],rgba.shape[0],0,gl.GL_RGBA,gl.GL_UNSIGNED_BYTE,rgba)
                gl.glTexParameteri(gl.GL_TEXTURE_2D,gl.GL_TEXTURE_MIN_FILTER,gl.GL_LINEAR);gl.glTexParameteri(gl.GL_TEXTURE_2D,gl.GL_TEXTURE_MAG_FILTER,gl.GL_LINEAR);gl.glTexParameteri(gl.GL_TEXTURE_2D,gl.GL_TEXTURE_WRAP_S,gl.GL_REPEAT);gl.glTexParameteri(gl.GL_TEXTURE_2D,gl.GL_TEXTURE_WRAP_T,gl.GL_REPEAT)
            self.resources.append({'vbo':vbo,'ibo':ibo,'count':len(faces),'texture':tex})
        self.pending_upload=False
    def paintGL(self):
        start=time.perf_counter()
        if not self.ready:
            painter=QPainter(self);painter.fillRect(self.rect(),QColor('#0e161f'));painter.setPen(QColor('#dfe9ec'));painter.drawText(self.rect(),Qt.AlignCenter,'3D requires an available OpenGL 3.3 backend.\n'+self.error);painter.end();return
        gl=self.gl;gl.glClear(gl.GL_COLOR_BUFFER_BIT|gl.GL_DEPTH_BUFFER_BIT)
        if self.model is None:return
        if getattr(self,'pending_upload',False):self.upload()
        gl.glBindVertexArray(self.vao);gl.glUseProgram(self.program);matrix=np.ascontiguousarray(camera_matrix(max(1,self.width()),max(1,self.height()),self.camera),np.float32)
        gl.glUniformMatrix4fv(gl.glGetUniformLocation(self.program,'mvp'),1,gl.GL_TRUE,matrix)
        override=PerformanceController.overrides(self.model,self.joints,self.animation_time,self.energy,self.action)
        surfaces=self.model.surfaces(self.animation_time,self.clip,override)
        order=[i for i,s in enumerate(surfaces) if s['alpha_mode']!='BLEND']+[i for i,s in enumerate(surfaces) if s['alpha_mode']=='BLEND']
        for i in order:
            p=surfaces[i];r=self.resources[i];data=np.ascontiguousarray(np.c_[p['world_positions'],p['world_normals'],p['uv']],np.float32)
            gl.glBindBuffer(gl.GL_ARRAY_BUFFER,r['vbo']);gl.glBufferData(gl.GL_ARRAY_BUFFER,data.nbytes,data,gl.GL_DYNAMIC_DRAW)
            for attr,size,offset in [(0,3,0),(1,3,12),(2,2,24)]:gl.glEnableVertexAttribArray(attr);gl.glVertexAttribPointer(attr,size,gl.GL_FLOAT,False,32,ctypes.c_void_p(offset))
            gl.glBindBuffer(gl.GL_ELEMENT_ARRAY_BUFFER,r['ibo']);gl.glUniform4fv(gl.glGetUniformLocation(self.program,'colour'),1,p['colour'])
            gl.glUniform1i(gl.glGetUniformLocation(self.program,'textured'),int(bool(r['texture'])));gl.glUniform1i(gl.glGetUniformLocation(self.program,'albedo'),0);gl.glActiveTexture(gl.GL_TEXTURE0);gl.glBindTexture(gl.GL_TEXTURE_2D,r['texture'])
            mode={'OPAQUE':0,'MASK':1,'BLEND':2}[p['alpha_mode']];gl.glUniform1i(gl.glGetUniformLocation(self.program,'alpha_mode'),mode);gl.glUniform1f(gl.glGetUniformLocation(self.program,'cutoff'),p['alpha_cutoff'])
            if p['double_sided']:gl.glDisable(gl.GL_CULL_FACE)
            else:gl.glEnable(gl.GL_CULL_FACE);gl.glCullFace(gl.GL_BACK)
            if mode==2:gl.glEnable(gl.GL_BLEND);gl.glBlendFunc(gl.GL_SRC_ALPHA,gl.GL_ONE_MINUS_SRC_ALPHA);gl.glDepthMask(False)
            else:gl.glDisable(gl.GL_BLEND);gl.glDepthMask(True)
            gl.glDrawElements(gl.GL_TRIANGLES,r['count'],gl.GL_UNSIGNED_INT,ctypes.c_void_p(0))
        gl.glDepthMask(True);gl.glUseProgram(0);gl.glBindVertexArray(0)
        end=time.perf_counter();self.paint_times.append((end-start)*1000)
        if self.last_paint is not None:self.paint_intervals.append((start-self.last_paint)*1000)
        self.last_paint=start;self.paint_count+=1
        del self.paint_times[:-3600];del self.paint_intervals[:-3600]
    def statistics(self):
        return {'paint_count':self.paint_count,'paint_submission_p95_ms':float(np.percentile(self.paint_times,95)) if self.paint_times else None,
                'observed_paint_interval_p95_ms':float(np.percentile(self.paint_intervals,95)) if self.paint_intervals else None,
                'observed_average_hz':1000/float(np.mean(self.paint_intervals)) if self.paint_intervals else None,
                'scope':'This viewport on this machine; submission time does not establish GPU completion or performance on the user computer.',
                'target_hz':120,'user_hardware_benchmarked':False,'artistic_acceptance':False}

class CelViewport(QWidget):
    def __init__(self,parent=None):
        super().__init__(parent);self.view=None;self.image=QImage();self.parts=[];self.energy=0.;self.action='idle';self.animation_time=0.;self.zoom=1.;self.setMinimumSize(360,360)
    def set_view(self,view,root):
        self.view=view;self.image=QImage(str(local_path(root,view['image'])))
        if self.image.isNull() or max(self.image.width(),self.image.height())>4096:raise ValueError('2D image failed decoding or exceeds 4096 pixels.')
        self.parts=[dict(part,decoded=QImage(str(local_path(root,part['image'])))) for part in view.get('parts',[])]
        if any(p['decoded'].isNull() for p in self.parts):raise ValueError('A 2D part failed decoding.')
        self.update()
    def paintEvent(self,event):
        painter=QPainter(self);self.draw(painter,self.width(),self.height());painter.end()
    def draw(self,painter,width,height):
        painter.fillRect(0,0,width,height,QColor('#0e161f'));painter.setRenderHint(QPainter.SmoothPixmapTransform)
        if self.image.isNull():return
        scale=min(width/self.image.width(),height/self.image.height())*self.zoom;x=(width-self.image.width()*scale)/2;y=(height-self.image.height()*scale)/2
        painter.translate(x,y);painter.scale(scale,scale);painter.drawImage(0,0,self.image)
        transforms={}
        for part in self.parts:
            painter.save()
            for ancestor in transforms.get(part.get('parent'),[]):painter.translate(*ancestor[0]);painter.rotate(ancestor[1])
            position=part['position'];angle=part.get('rest_rotation_deg',0)
            if self.action=='gesture' and part.get('control') in ('right_shoulder','right_elbow','right_wrist'):angle+=-35*math.sin(math.pi*(self.animation_time%3)/3)**2
            painter.translate(*position);painter.rotate(angle);painter.drawImage(-part['pivot'][0],-part['pivot'][1],part['decoded']);painter.restore()
            transforms[part['part_id']]=transforms.get(part.get('parent'),[])+[(position,angle)]
        mouth=self.view.get('mouth')
        if mouth and self.energy>.05:
            cx,cy,rx,ry=mouth;region=QPainterPath();region.addEllipse(cx-rx,cy-ry,rx*2,ry*2);painter.setClipPath(region);painter.setPen(Qt.NoPen);painter.setBrush(QColor('#251a21'));painter.drawEllipse(cx-rx,cy-ry*self.energy,rx*2,ry*2*self.energy)

class UnavailableSurfaceViewport(QWidget):
    availability=Signal(bool,str)
    def __init__(self):
        super().__init__();self.ready=False;self.model=None;self.joints={};self.camera=benchmark_shots()[0].copy();self.animation_time=0.;self.energy=0.;self.action='idle';self.clip=None;self.setMinimumSize(360,360)
    def set_model(self,model,joints):self.model=model;self.joints=joints
    def paintEvent(self,event):
        painter=QPainter(self);painter.fillRect(self.rect(),QColor('#0e161f'));painter.setPen(QColor('#e1eeee'));painter.drawText(self.rect(),Qt.AlignCenter,'3D needs an available OpenGL 3.3 backend.\nSelect a supplied 2D view to continue.');painter.end()
    def statistics(self):return {'backend_available':False,'native_windows_execution_tested':False}

def surface_viewport():
    fmt=QSurfaceFormat();fmt.setVersion(3,3);fmt.setProfile(QSurfaceFormat.CoreProfile);fmt.setDepthBufferSize(24)
    context=QOpenGLContext();context.setFormat(fmt);surface=QOffscreenSurface();surface.setFormat(fmt);surface.create()
    if not context.create() or not context.makeCurrent(surface):return UnavailableSurfaceViewport()
    version=context.format();context.doneCurrent()
    if (version.majorVersion(),version.minorVersion())<(3,3):return UnavailableSurfaceViewport()
    return SurfaceViewport()

class CompanionWidget(QWidget):
    """Embeddable QWidget; the same instance type is used by the desktop app."""
    def __init__(self,studio,job_callback=None,settings_callback=None,reply_provider=None,speech_adapter=None,parent=None):
        super().__init__(parent);self.studio=studio;self.session=ConversationSession(studio,reply_provider,speech_adapter);self.job_callback=job_callback;self.settings_callback=settings_callback or (lambda:{})
        self.presenter_id=uuid.uuid4().hex;self.active=None;self.last_turn=None;self.sink=None;self.audio_buffer=None;self.performance=PerformanceController();self.clock=QElapsedTimer();self.clock.start();self.preview_until=None
        layout=QVBoxLayout(self);top=QHBoxLayout();self.profiles=QComboBox();top.addWidget(QLabel('Character'));top.addWidget(self.profiles,1)
        self.mode=QComboBox();self.mode.addItem('2D authored views','2d');self.mode.addItem('3D surfaces','3d');top.addWidget(self.mode);self.views=QComboBox();top.addWidget(self.views);layout.addLayout(top)
        self.role_label=QLabel();self.role_label.setWordWrap(True);layout.addWidget(self.role_label)
        split=QSplitter();self.visual=QStackedWidget();self.cel=CelViewport();self.surface=surface_viewport();self.visual.addWidget(self.cel);self.visual.addWidget(self.surface);split.addWidget(self.visual)
        chat=QWidget();c=QVBoxLayout(chat);self.history_label=QLabel();c.addWidget(self.history_label);self.messages=QPlainTextEdit();self.messages.setReadOnly(True);c.addWidget(self.messages,1)
        self.input=QPlainTextEdit();self.input.setPlaceholderText('Write to this character. Imported history remains stored in full.');self.input.setMaximumHeight(105);c.addWidget(self.input)
        line=QHBoxLayout();self.send=QPushButton('Send and speak');self.send.clicked.connect(lambda:self.guard(self.send_message));line.addWidget(self.send);self.retry=QPushButton('Retry speech');self.retry.clicked.connect(lambda:self.guard(self.retry_speech));line.addWidget(self.retry);c.addLayout(line);split.addWidget(chat);split.setSizes([650,400]);layout.addWidget(split,1)
        controls=QHBoxLayout();self.action=QComboBox();[self.action.addItem(a,a) for a in ('idle','talk','gesture','step')];controls.addWidget(QLabel('Authored state'));controls.addWidget(self.action)
        self.delivery_fps=QComboBox();[self.delivery_fps.addItem(str(n)+' fps',n) for n in (60,120,240)];controls.addWidget(self.delivery_fps)
        self.clips=QComboBox();self.clips.addItem('No authored clip',None);self.clips.currentIndexChanged.connect(lambda:self.guard(self.select_clip));controls.addWidget(self.clips)
        self.shots=QComboBox();self.shots.addItem('Manual camera',None)
        for shot in benchmark_shots():self.shots.addItem(shot['shot_id'],shot)
        controls.addWidget(self.shots);self.yaw=QDoubleSpinBox();self.yaw.setRange(-360,360);self.yaw.setSuffix('° yaw');controls.addWidget(self.yaw);self.pitch=QDoubleSpinBox();self.pitch.setRange(-80,80);self.pitch.setValue(5);self.pitch.setSuffix('° elevation');controls.addWidget(self.pitch)
        self.radius=QDoubleSpinBox();self.radius.setRange(.2,10);self.radius.setValue(3.2);self.radius.setSingleStep(.1);self.radius.setSuffix(' distance');controls.addWidget(self.radius);layout.addLayout(controls)
        tools=QHBoxLayout()
        for label,callback in [('Import chat log',self.import_history),('Export full history',self.export_history),('Import character ZIP',self.import_character),('Select local text GGUF',self.select_model),('Replay speech',self.replay),('Preview 12-second action',self.preview),('Export companion movie',self.export_movie),('Save render timings',self.save_statistics)]:
            button=QPushButton(label);button.clicked.connect(lambda checked=False,fn=callback:self.guard(fn));tools.addWidget(button)
        layout.addLayout(tools);self.status=QLabel('Ready. Mouth timing follows speech energy; phoneme alignment is not inferred.');self.status.setWordWrap(True);layout.addWidget(self.status)
        self.model_path=None;self.profiles.currentIndexChanged.connect(self.select_profile);self.mode.currentIndexChanged.connect(lambda:self.guard(self.select_mode));self.views.currentIndexChanged.connect(lambda:self.guard(self.select_view));self.action.currentIndexChanged.connect(lambda:self.guard(self.select_action));self.shots.currentIndexChanged.connect(self.select_shot)
        for control in (self.yaw,self.pitch,self.radius):control.valueChanged.connect(self.camera_changed)
        self.surface.availability.connect(self.backend_status);self.timer=QTimer(self);self.timer.setTimerType(Qt.PreciseTimer);self.timer.setInterval(8);self.timer.timeout.connect(self.tick);self.timer.start();self.refresh()
    def guard(self,fn):
        try:fn()
        except Exception as exc:self.status.setText(str(exc));QMessageBox.warning(self,'Character companion',str(exc))
    def refresh(self):
        pid=self.profiles.currentData();self.profiles.blockSignals(True);self.profiles.clear()
        for p in self.studio.profiles():self.profiles.addItem(p['name'],p['id'])
        index=self.profiles.findData(pid)
        if index>=0:self.profiles.setCurrentIndex(index)
        self.profiles.blockSignals(False);self.select_profile()
    def pid(self):
        pid=self.profiles.currentData()
        if not pid:raise ValueError('Create a character/voice profile first.')
        return pid
    def select_profile(self):
        if not self.profiles.currentData():self.active=None;return
        self.stop_audio();profile=self.studio.profile(self.pid());self.active=self.session.characters.ensure_profile(profile);self.role_label.setText(self.active.get('visual_role','Imported character assets.'))
        self.model_path=self.active.get('dialogue',{}).get('model_path')
        with self.session.history.connect() as db:
            row=db.execute('SELECT receipt FROM turns WHERE character_id=? AND status=? ORDER BY created_at DESC LIMIT 1',(self.pid(),'reply_ready')).fetchone()
        self.last_turn=json.loads(row[0]) if row else None
        self.mode.blockSignals(True);self.mode.setCurrentIndex(self.mode.findData(self.active.get('presentation',{}).get('mode','2d')));self.mode.blockSignals(False)
        self.set_views();self.guard(self.select_mode);self.refresh_history()
    def set_views(self):
        self.views.blockSignals(True);self.views.clear()
        for v in self.active.get('two_d',{}).get('views',[]):self.views.addItem(v['view_id']+(' · unmeasured angle' if v['calibration_status']=='unmeasured' else ''),v['view_id'])
        index=self.views.findData(self.active.get('presentation',{}).get('view_id'))
        if index>=0:self.views.setCurrentIndex(index)
        self.views.blockSignals(False)
    def select_mode(self):
        if not self.active:return
        mode=self.mode.currentData()
        try:value=self.session.characters.select(self.pid(),mode,self.views.currentData())
        except ValueError:
            self.mode.blockSignals(True);self.mode.setCurrentIndex(self.mode.findData(self.active.get('presentation',{}).get('mode','2d')));self.mode.blockSignals(False);raise
        self.active=value;root=self.session.characters.asset_root(value)
        if mode=='3d':
            representation=value['three_d'];self.surface.set_model(SurfaceModel.load(local_path(root,representation['asset'])),representation.get('joint_mapping',{}));self.visual.setCurrentWidget(self.surface)
        else:self.select_view();self.visual.setCurrentWidget(self.cel)
        self.views.setEnabled(mode=='2d')
        for control in (self.yaw,self.pitch,self.radius,self.shots):control.setEnabled(mode=='3d')
        self.select_action()
    def select_view(self):
        if not self.active or self.mode.currentData()!='2d':return
        value=self.session.characters.select(self.pid(),'2d',self.views.currentData());self.active=value;view=next(v for v in value['two_d']['views'] if v['view_id']==self.views.currentData());self.cel.set_view(view,self.session.characters.asset_root(value));self.select_action()
    def select_action(self):
        if not self.active:return
        representation=self.active['three_d'] if self.mode.currentData()=='3d' else next(v for v in self.active['two_d']['views'] if v['view_id']==self.views.currentData())
        supported=representation.get('supported_actions',['idle','talk']);requested=self.action.currentData()
        if requested not in supported:
            self.action.blockSignals(True);self.action.setCurrentIndex(0);self.action.blockSignals(False);self.status.setText('That action is unavailable in this view; additional authored parts/poses are required.')
        self.surface.action=self.action.currentData();self.cel.action=self.action.currentData()
    def select_shot(self):
        shot=self.shots.currentData()
        if shot:
            for control,key in [(self.yaw,'azimuth_deg'),(self.pitch,'elevation_deg'),(self.radius,'radius')]:control.blockSignals(True);control.setValue(shot[key]);control.blockSignals(False)
            self.surface.camera=shot.copy();self.surface.update()
    def camera_changed(self):
        self.surface.camera.update(azimuth_deg=self.yaw.value(),elevation_deg=self.pitch.value(),radius=self.radius.value());self.surface.update()
    def backend_status(self,ready,message):self.status.setText(message)
    def refresh_history(self):
        pid=self.pid();count=self.session.history.count(pid);rows=self.session.history.messages(pid,200,max(0,count-200));self.messages.setPlainText('\n\n'.join(r['role'].upper()+': '+r['content'] for r in rows));self.history_label.setText(f'{count} messages stored in full · showing the latest {len(rows)}');bar=self.messages.verticalScrollBar();bar.setValue(bar.maximum())
    def settings(self):
        result=dict(self.settings_callback() or {});result.update(model_path=self.model_path,speak=True,presentation_source=self.presenter_id)
        if 'language_settings' not in result and 'synthesis_language' in result:
            result['language_settings']={k:result[k] for k in ('interface_language','reply_language','transcription_language','synthesis_language','speech_engine') if k in result}
        return result
    def submit(self,operation,args):
        if not self.job_callback:raise ValueError('Register a host job runner for this widget. ConversationSession supports direct programmatic execution.')
        self.job_callback(operation,args);self.status.setText('Processing locally. The viewport remains active; use the application cancel control to stop.')
    def send_message(self):
        text=self.input.toPlainText();self.submit('companion_reply',{'pid':self.pid(),'text':text,'settings':self.settings()});self.input.clear()
    def retry_speech(self):
        if not self.last_turn:raise ValueError('Select a completed conversation turn first.')
        self.submit('companion_speech',{'turn_id':self.last_turn['turn_id'],'settings':self.settings()})
    def handle_result(self,operation,result):
        if operation in ('companion_reply','companion_speech'):
            self.last_turn=result
            if result['profile_id']!=self.profiles.currentData():self.status.setText('Reply finished for another character. Select that profile to inspect its saved history.');return
            self.refresh_history()
            if result.get('presentation_source') not in (None,self.presenter_id):self.status.setText('Shared character history updated; speech plays in the requesting window.');return
            if result.get('audio_status')=='ready':self.play_file(result['speech']['audio_path']);self.status.setText('Reply and speech are ready. Energy timing drives this authored performance.')
            elif result.get('audio_status')=='failed':self.status.setText('Reply saved; speech failed: '+result.get('speech_error','')+'. Adjust speech settings and retry.')
        elif operation=='companion_export':self.status.setText('Movie saved: '+result['path']+'; '+str(result['frames'])+' frames at '+str(result['fps'])+' fps. Artistic review remains open.')
        elif operation in ('companion_import','companion_character'):self.select_profile();self.status.setText('Import complete. Original data and profile binding are preserved.')
    def stop_audio(self):
        if self.sink:self.sink.stop();self.sink.deleteLater();self.sink=None
        if self.audio_buffer:self.audio_buffer.close();self.audio_buffer.deleteLater();self.audio_buffer=None
        self.preview_until=None
    def play_file(self,path):
        self.stop_audio();self.performance.load(path)
        with wave.open(str(path),'rb') as w:pcm=w.readframes(w.getnframes())
        device=QMediaDevices.defaultAudioOutput()
        if device.isNull():raise ValueError('No audio output device is available. The WAV is saved; use the action preview for silent inspection.')
        fmt=QAudioFormat();fmt.setSampleRate(self.performance.sample_rate);fmt.setChannelCount(1);fmt.setSampleFormat(QAudioFormat.Int16)
        if not device.isFormatSupported(fmt):
            fmt=device.preferredFormat();rate=fmt.sampleRate();channels=fmt.channelCount()
            if not 8000<=rate<=192000 or not 1<=channels<=8:raise ValueError('Unsupported output-device format; the original WAV is saved.')
            samples=np.frombuffer(pcm,'<i2').astype(np.float64)/32768
            samples=np.interp(np.arange(round(len(samples)*rate/self.performance.sample_rate))*self.performance.sample_rate/rate,np.arange(len(samples)),samples)
            samples=np.repeat(samples[:,None],channels,axis=1)
            if fmt.sampleFormat()==QAudioFormat.Float:encoded=samples.astype('<f4')
            elif fmt.sampleFormat()==QAudioFormat.Int16:encoded=np.rint(np.clip(samples,-1,1-1/32768)*32768).astype('<i2')
            elif fmt.sampleFormat()==QAudioFormat.Int32:encoded=np.rint(np.clip(samples,-1,1-1/2**31)*2**31).astype('<i4')
            elif fmt.sampleFormat()==QAudioFormat.UInt8:encoded=np.rint(np.clip(samples*.5+.5,0,1)*255).astype('u1')
            else:raise ValueError('Unsupported output sample type; the WAV is saved.')
            pcm=encoded.tobytes()
        self.audio_data=QByteArray(pcm);self.audio_buffer=QBuffer(self);self.audio_buffer.setData(self.audio_data);self.audio_buffer.open(QIODevice.ReadOnly)
        self.sink=QAudioSink(device,fmt,self);self.sink.start(self.audio_buffer)
    def replay(self):
        if not self.last_turn or self.last_turn.get('audio_status')!='ready':raise ValueError('Generate speech for this character first.')
        if self.last_turn['profile_id']!=self.pid():raise ValueError('Select the character bound to that speech turn.')
        self.play_file(self.last_turn['speech']['audio_path'])
    def select_clip(self):self.surface.clip=self.clips.currentData();self.clock.restart();self.surface.update()
    def export_movie(self):
        path,_=QFileDialog.getSaveFileName(self,'Export companion movie','FULL_REZZ_Companion.webm','WebM (*.webm)')
        if path:self.submit('companion_export',{'pid':self.pid(),'mode':self.mode.currentData(),'view_id':self.views.currentData(),'clip':self.clips.currentData(),'action':self.action.currentData(),'fps':self.delivery_fps.currentData(),'path':path,'turn_id':self.last_turn.get('turn_id') if self.last_turn else None})
    def preview(self):self.stop_audio();self.clock.restart();self.preview_until=12.;self.status.setText('Silent authored action preview. It does not generate new speech or missing views.')
    def tick(self):
        t=self.clock.elapsed()/1000;audio_t=self.sink.processedUSecs()/1e6 if self.sink else 0.;playing=self.sink is not None and self.sink.state().name=='ActiveState';energy=self.performance.aperture(audio_t,playing=playing)
        if self.sink and audio_t>=self.performance.duration:energy=0.
        if self.preview_until is not None and t>=self.preview_until:self.preview_until=None
        state='talk' if playing and self.action.currentData()=='idle' else self.action.currentData();self.surface.action=state;self.cel.action=state
        self.surface.animation_time=t;self.cel.animation_time=t;self.surface.energy=energy;self.cel.energy=energy
        self.visual.currentWidget().update()
    def import_history(self):
        path,_=QFileDialog.getOpenFileName(self,'Import full chat history','','Chat logs (*.json *.jsonl *.csv *.txt *.md)')
        if not path:return
        mapping={};suffix=Path(path).suffix.lower()
        if suffix=='.csv':
            with Path(path).open(encoding='utf-8-sig',newline='') as file:headers=next(csv.reader(file))
            role,ok=QInputDialog.getItem(self,'CSV role mapping','Choose the role column',headers,headers.index('role') if 'role' in headers else 0,False)
            if not ok:return
            content,ok=QInputDialog.getItem(self,'CSV content mapping','Choose the content column',headers,headers.index('content') if 'content' in headers else 0,False)
            if not ok:return
            mapping={'role':role,'content':content}
        elif suffix in ('.txt','.md'):
            value,ok=QInputDialog.getMultiLineText(self,'Review speaker mapping','Map exact speaker labels to user / assistant / system / tool roles.','{"User":"user","Assistant":"assistant"}')
            if not ok:return
            mapping={'speakers':json.loads(value)}
        self.submit('companion_import',{'pid':self.pid(),'path':path,'mapping':mapping})
    def export_history(self):
        path,_=QFileDialog.getSaveFileName(self,'Export the full stored history','Character_History.json','JSON (*.json)')
        if path:self.session.history.export(self.pid(),path);self.status.setText('Full history exported with source provenance.')
    def import_character(self):
        path,_=QFileDialog.getOpenFileName(self,'Import a character asset pack','','Character ZIP (*.zip)')
        if path:self.submit('companion_character',{'pid':self.pid(),'path':path})
    def select_model(self):
        path,_=QFileDialog.getOpenFileName(self,'Select the main text GGUF model','','GGUF (*.gguf)')
        if path:
            from .dialogue import gguf_architecture
            architecture=gguf_architecture(path)
            if architecture!='qwen2':raise ValueError('Select a Qwen2-family text model for the bundled chat template. A host adapter can provide other model families.')
            self.model_path=path;self.active.setdefault('dialogue',{})['model_path']=path;self.session.characters.save(self.active);self.status.setText('Selected local text model: '+Path(path).name)
    def save_statistics(self):
        path,_=QFileDialog.getSaveFileName(self,'Save observed rendering timings','FULL_REZZ_Render_Timings.json','JSON (*.json)')
        if path:Path(path).write_text(json.dumps(self.surface.statistics(),indent=2)+'\n');self.status.setText('Observed viewport timings saved; no studio-quality score is assigned.')
    def closeEvent(self,event):self.stop_audio();self.timer.stop();super().closeEvent(event)

def apply_widget_locale(widget,localizer):
    widget.setLayoutDirection(Qt.RightToLeft if localizer.locale=='ar' else Qt.LeftToRight)
    for cls in (QLabel,QPushButton):
        for child in widget.findChildren(cls):
            source=child.property('ui_source') or child.text()
            if source in localizer.catalogs['en']:child.setProperty('ui_source',source);child.setText(localizer.text(source))
    for combo in widget.findChildren(QComboBox):
        combo.blockSignals(True)
        for i in range(combo.count()):
            source=combo.itemData(i,Qt.UserRole+1) or combo.itemText(i)
            if source in localizer.catalogs['en']:combo.setItemData(i,source,Qt.UserRole+1);combo.setItemText(i,localizer.text(source))
        combo.blockSignals(False)
