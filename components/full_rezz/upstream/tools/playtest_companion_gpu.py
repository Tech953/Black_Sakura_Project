"""Validate actual surface draw code in headless EGL, independently of Qt presentation."""
import os
os.environ.setdefault('PYOPENGL_PLATFORM','egl')
from pathlib import Path
import ctypes,hashlib,json,sys,time
import numpy as np
from PIL import Image
from OpenGL import EGL as egl,GL
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'FULL_REZZ/app'))
from full_rezz_companion.qt import SurfaceViewport
from full_rezz_companion.gltf import SurfaceModel
from full_rezz_companion.characters import ASSETS
from full_rezz_companion.performance import benchmark_shots
class Signal:
 def emit(self,*args):pass
class Renderer:
 initializeGL=SurfaceViewport.initializeGL;clear_resources=SurfaceViewport.clear_resources;upload=SurfaceViewport.upload;paintGL=SurfaceViewport.paintGL
 def width(self):return 640
 def height(self):return 640
 def context(self):return None
 def __init__(self):
  self.model=SurfaceModel.load(ASSETS/'studio_unit/studio_unit.gltf');self.joints=json.loads((ASSETS/'studio_unit/character.json').read_text())['three_d']['joint_mapping'];self.resources=[];self.program=None;self.availability=Signal();self.ready=False;self.error='';self.animation_time=0.;self.energy=.5;self.action='gesture';self.clip=0;self.camera=benchmark_shots()[0];self.paint_times=[];self.paint_intervals=[];self.last_paint=None;self.paint_count=0

def main():
 output=ROOT/'evidence/product_v3/gpu_views';output.mkdir(parents=True,exist_ok=True)
 proc=egl.eglGetProcAddress(b'eglGetPlatformDisplayEXT');get=ctypes.CFUNCTYPE(ctypes.c_void_p,ctypes.c_uint,ctypes.c_void_p,ctypes.POINTER(ctypes.c_int))(proc);display=get(0x31DD,None,None);major=ctypes.c_int();minor=ctypes.c_int()
 if not egl.eglInitialize(display,major,minor):raise RuntimeError('Surfaceless EGL unavailable.')
 attrs=(ctypes.c_int*13)(egl.EGL_SURFACE_TYPE,egl.EGL_PBUFFER_BIT,egl.EGL_RENDERABLE_TYPE,egl.EGL_OPENGL_BIT,egl.EGL_RED_SIZE,8,egl.EGL_GREEN_SIZE,8,egl.EGL_BLUE_SIZE,8,egl.EGL_DEPTH_SIZE,24,egl.EGL_NONE);config=egl.EGLConfig();count=ctypes.c_int();egl.eglChooseConfig(display,attrs,ctypes.byref(config),1,count);egl.eglBindAPI(egl.EGL_OPENGL_API)
 ca=(ctypes.c_int*7)(0x3098,3,0x30FB,3,0x30FD,1,egl.EGL_NONE);context=egl.eglCreateContext(display,config,egl.EGL_NO_CONTEXT,ca);pa=(ctypes.c_int*5)(egl.EGL_WIDTH,640,egl.EGL_HEIGHT,640,egl.EGL_NONE);surface=egl.eglCreatePbufferSurface(display,config,pa)
 if not egl.eglMakeCurrent(display,surface,surface,context):raise RuntimeError('OpenGL context unavailable.')
 r=Renderer();r.initializeGL()
 if not r.ready:raise RuntimeError(r.error)
 GL.glViewport(0,0,640,640);views=[]
 for shot in benchmark_shots():
  r.camera=shot;r.animation_time=1.25;r.paintGL();GL.glFinish();raw=GL.glReadPixels(0,0,640,640,GL.GL_RGBA,GL.GL_UNSIGNED_BYTE);rgba=np.frombuffer(raw,np.uint8).reshape(640,640,4)[::-1].copy();name=shot['shot_id']+'.png';Image.fromarray(rgba).save(output/name);views.append({'shot_id':shot['shot_id'],'image':name,'rgba_sha256':hashlib.sha256(rgba.tobytes()).hexdigest()})
  if np.count_nonzero(np.any(rgba[:,:,:3]!=[14,22,31],axis=2))<100:raise ValueError('Empty surface frame')
 if len({v['rgba_sha256'] for v in views})!=6:raise ValueError('The six camera views are not distinct.')
 times=[];start=time.perf_counter()
 for i in range(180):
  r.camera=benchmark_shots()[i//30];r.animation_time=i/120;begin=time.perf_counter();r.paintGL();GL.glFinish();times.append((time.perf_counter()-begin)*1000)
 elapsed=time.perf_counter()-start
 result={'scope':'Actual surface draw code in Linux headless EGL; not Qt desktop/Windows presentation','renderer':GL.glGetString(GL.GL_RENDERER).decode(),'gl_version':GL.glGetString(GL.GL_VERSION).decode(),'model_vertices':r.model.vertex_count,'model_triangles':r.model.triangle_count,'views':views,'distinct_camera_views':6,'rendered_test_frames':180,'resolution':[640,640],'completed_frame_p95_ms':float(np.percentile(times,95)),'observed_completed_frames_per_second':180/elapsed,'gl_finish_included':True,'native_windows_execution_tested':False,'qt_desktop_frame_pacing_tested':False,'user_hardware_benchmarked':False,'artistic_acceptance':False}
 (ROOT/'evidence/product_v3/GPU_Validation.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='views'},indent=2));r.clear_resources();GL.glDeleteProgram(r.program);GL.glDeleteVertexArrays(1,[r.vao]);egl.eglMakeCurrent(display,egl.EGL_NO_SURFACE,egl.EGL_NO_SURFACE,egl.EGL_NO_CONTEXT);egl.eglDestroySurface(display,surface);egl.eglDestroyContext(display,context);egl.eglTerminate(display)
if __name__=='__main__':main()
