"""Native Linux startup checks; target Windows/audio/GPU acceptance is separate."""
from pathlib import Path
import tempfile,json,sys
import numpy as np
from PySide6.QtWidgets import QApplication
from PySide6.QtGui import QImage,QPainter
from PySide6.QtCore import Qt
R=Path(__file__).resolve().parents[1];A=R/'FULL_REZZ/app';sys.path.insert(0,str(A))
from voice_studio.desktop import Window
from voice_studio.languages import LOCALES
def main():
 app=QApplication.instance() or QApplication([])
 with tempfile.TemporaryDirectory(prefix='full-rezz-ui-') as tmp:
  root=Path(tmp);w=Window(root/'workspace',root/'settings.json');assert w.tabs.count()==9
  assert w.companion.profiles.count()>0;pid=w.companion.profiles.currentData()
  w.open_companion();other=w.companion_window
  assert other.studio.root==w.studio.root and other.profiles.currentData()==pid
  locales=[]
  for code in LOCALES:
   control=w.language_controls['interface_language'];control.setCurrentIndex(control.findData(code));app.processEvents()
   assert w.settings.interface_language==code
   assert all(w.tabs.tabText(i) for i in range(w.tabs.count()))
   assert (w.layoutDirection()==Qt.RightToLeft)==(code=='ar')
   assert w.companion.profiles.currentData()==pid
   locales.append(code)
  w.language_controls['interface_language'].setCurrentIndex(w.language_controls['interface_language'].findData('en'))
  cel=w.companion.cel;assert not cel.image.isNull()
  image=QImage(640,360,QImage.Format_RGBA8888);painter=QPainter(image);cel.draw(painter,640,360);painter.end()
  pixels=np.frombuffer(image.bits(),np.uint8).reshape(360,image.bytesPerLine())[:,:640*4].reshape(360,640,4)
  assert float(pixels[:,:,:3].std())>10,'The actual supplied cel did not produce a visible image'
  report={'native_linux_offscreen_startup_passed':True,'tabs':9,'embedded_and_detached_share_workspace_and_profile':True,'localized_interface_switches':locales,'arabic_RTL_verified':True,'actual_authored_2d_pixels_rendered':True,'native_windows_execution_tested':False,'audio_device_playback_tested':False,'target_GPU_driver_tested':False}
  other.close();w.close();w.project_lock.close();app.processEvents()
 (R/'evidence/rebuild_20261014/native_ui.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
