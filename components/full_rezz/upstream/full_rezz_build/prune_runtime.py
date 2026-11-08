"""Retain the Qt widget/WebEngine application and its complete declared DLL closure."""
from pathlib import Path
import json,shutil
ROOT=Path(__file__).resolve().parent;BASE=ROOT/'windows_bundle';SITE=BASE/'runtime/Lib/site-packages';QT=SITE/'PySide6'
scope={'__file__':str(ROOT/'check_pe_dependencies.py'),'__name__':'pe_reader'}
exec((ROOT/'check_pe_dependencies.py').read_text().split('SYSTEM=set')[0],scope)
scope['BASE']=BASE;inspect=scope['inspect']
all_binaries={p.name.lower():p for p in QT.glob('*') if p.suffix.lower() in ('.dll','.pyd','.exe')}
roots={'qtcore.pyd','qtgui.pyd','qtwidgets.pyd','qtqml.pyd','qtquick.pyd','qtquickwidgets.pyd','qtwebenginecore.pyd','qtwebenginewidgets.pyd','qtnetwork.pyd','qtprintsupport.pyd','qtwebchannel.pyd','qtwebengineprocess.exe','opengl32sw.dll'}
roots.update(p.name.lower() for p in QT.glob('*pyside*.dll'))
plugins=[]
for folder in ('platforms','styles','imageformats','iconengines','generic'):
 plugins.extend((QT/'plugins'/folder).glob('*.dll'))
closure=set();queue=[all_binaries[n] for n in roots if n in all_binaries]+plugins+list((QT/'qml').rglob('*.dll'))
while queue:
 p=queue.pop();name=p.name.lower()
 if name in closure:continue
 closure.add(name);e=inspect(p)
 if e:
  for dep in e['imports']+e['delay_imports']:
   if dep in all_binaries and dep not in closure:queue.append(all_binaries[dep])
removed=[]
for p in list(QT.glob('*')):
 if p.is_file() and p.suffix.lower() in ('.dll','.pyd','.exe') and p.name.lower() not in closure:
  removed.append({'path':p.relative_to(BASE).as_posix(),'bytes':p.stat().st_size});p.unlink()
for folder in list((QT/'plugins').iterdir()):
 if folder.is_dir() and folder.name not in ('platforms','styles','imageformats','iconengines','generic'):
  removed.extend({'path':p.relative_to(BASE).as_posix(),'bytes':p.stat().st_size} for p in folder.rglob('*') if p.is_file());shutil.rmtree(folder)
for folder in ['glue','include','typesystems','scripts']:
 p=QT/folder
 if p.is_dir():removed.extend({'path':x.relative_to(BASE).as_posix(),'bytes':x.stat().st_size} for x in p.rglob('*') if x.is_file());shutil.rmtree(p)
for name in ['qtwebengine_devtools_resources.debug.pak','qtwebengine_devtools_resources.pak']:
 p=QT/'resources'/name
 if p.exists():removed.append({'path':p.relative_to(BASE).as_posix(),'bytes':p.stat().st_size});p.unlink()
shutil.rmtree(SITE/'torch/include',ignore_errors=True)
report={'application_roots':sorted(roots),'retained_qt_binaries':sorted(closure),'removed_files':removed,'removed_bytes':sum(x['bytes'] for x in removed),'scope':'Unused Qt Python bindings and development/debug resources. Widget/WebEngine, Qt Python support, QML resources, Windows platform/style/image plugins, translations, primary WebEngine resources and their declared DLL closure remain.','models_modified':False,'native_windows_execution_tested':False}
(ROOT/'runtime_pruning.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k not in ('removed_files','retained_qt_binaries')}))
