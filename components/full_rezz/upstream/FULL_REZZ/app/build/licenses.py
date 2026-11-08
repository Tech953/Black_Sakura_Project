import urllib.request,json,hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path(__file__).resolve().parents[1]/'licenses';root.mkdir(exist_ok=True)
items={
'F5-TTS-MIT.txt':'https://raw.githubusercontent.com/SWivid/F5-TTS/main/LICENSE',
'F5-Weights-CC-BY-NC-4.0.txt':'https://raw.githubusercontent.com/spdx/license-list-data/main/text/CC-BY-NC-4.0.txt',
'Vocos-MIT.txt':'https://raw.githubusercontent.com/gemelo-ai/vocos/main/LICENSE',
'Whisper-MIT.txt':'https://raw.githubusercontent.com/openai/whisper/main/LICENSE',
'SpeechBrain-Apache.txt':'https://raw.githubusercontent.com/speechbrain/speechbrain/develop/LICENSE',
'Silero-MIT.txt':'https://raw.githubusercontent.com/snakers4/silero-vad/master/LICENSE',
'Qt-LGPL-3.0.txt':'https://raw.githubusercontent.com/qt/qtbase/v6.8.3/LICENSES/LGPL-3.0-only.txt',
'Qt-GPL-3.0.txt':'https://raw.githubusercontent.com/qt/qtbase/v6.8.3/LICENSES/GPL-3.0-only.txt'}
for n in ['qtbase','qtdeclarative','qttools','qtsvg','qtshadertools','qtimageformats','qtlanguageserver','qttranslations']:items['corresponding_source/'+n+'-everywhere-src-6.8.3.tar.xz']='https://download.qt.io/archive/qt/6.8/6.8.3/submodules/'+n+'-everywhere-src-6.8.3.tar.xz'
items['corresponding_source/pyside-setup-everywhere-src-6.8.3.tar.xz']='https://download.qt.io/official_releases/QtForPython/pyside6/PySide6-6.8.3-src/pyside-setup-everywhere-src-6.8.3.tar.xz'
def get(item):
 name,url=item;p=root/name;p.parent.mkdir(parents=True,exist_ok=True)
 if not p.exists():urllib.request.urlretrieve(url,p)
 return {'path':name,'source':url,'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest()}
with ThreadPoolExecutor(max_workers=4) as ex:r=list(ex.map(get,items.items()))
(root/'source_manifest.json').write_text(json.dumps(r,indent=2));print('License and corresponding-source files acquired',len(r),flush=True)
