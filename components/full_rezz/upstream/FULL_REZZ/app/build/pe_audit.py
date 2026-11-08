from pathlib import Path
import pefile,json
root=Path(__file__).resolve().parent/'package';names={p.name.casefold() for p in root.rglob('*') if p.is_file()};system=set('cabinet.dll msi.dll avicap32.dll ncrypt.dll uxtheme.dll combase.dll pdh.dll uiautomationcore.dll kernel32.dll kernelbase.dll user32.dll advapi32.dll shell32.dll shlwapi.dll ole32.dll oleaut32.dll comdlg32.dll gdi32.dll winmm.dll ws2_32.dll crypt32.dll secur32.dll bcrypt.dll bcryptprimitives.dll ntdll.dll ucrtbase.dll msvcrt.dll version.dll winspool.drv imm32.dll setupapi.dll cfgmgr32.dll iphlpapi.dll netapi32.dll userenv.dll psapi.dll powrprof.dll dwmapi.dll d3d11.dll dxgi.dll dwrite.dll d2d1.dll d3d12.dll opengl32.dll glu32.dll wtsapi32.dll wintrust.dll normaliz.dll wldap32.dll dnsapi.dll rpcrt4.dll dbghelp.dll dbgcore.dll mswsock.dll authz.dll usp10.dll comctl32.dll propsys.dll dhcpcsvc.dll winhttp.dll wininet.dll hid.dll dsound.dll avrt.dll mf.dll mfplat.dll mfreadwrite.dll mfuuid.dll d3dcompiler_47.dll vcomp140.dll mpr.dll credui.dll d3d9.dll dxva2.dll msvfw32.dll imagehlp.dll oleacc.dll winsta.dll winusb.dll'.split());missing=[];count=0
for p in root.rglob('*'):
 if p.suffix.lower() not in ('.exe','.dll','.pyd'):continue
 try:
  pe=pefile.PE(str(p),fast_load=True);pe.parse_data_directories(directories=[pefile.DIRECTORY_ENTRY['IMAGE_DIRECTORY_ENTRY_IMPORT']]);count+=1
  for e in getattr(pe,'DIRECTORY_ENTRY_IMPORT',[]):
   n=e.dll.decode().casefold()
   if n not in names and n not in system and not n.startswith(('api-ms-win-','ext-ms-win-')):missing.append({'file':p.relative_to(root).as_posix(),'import':n})
  pe.close()
 except pefile.PEFormatError:pass
r={'pe_files_checked':count,'unresolved_import_names':missing,'passed':not missing,'limits':'Import-name coverage only; no Windows execution, ABI/export-symbol/loader compatibility or playback verified.'};(root.parent.parent/'audit/windows_pe.json').write_text(json.dumps(r,indent=2));print(json.dumps(r),flush=True)

# Explicit generic speech child search: app-local CLI/DLL + private CPython PATH.
child_roots=[root/'app/vendor/espeak-ng',root/'python'];child_files=[{p.name.casefold():p for p in directory.iterdir() if p.is_file()} for directory in child_roots];private_errors=[];private_checked=[]
for relative in ['app/vendor/espeak-ng/espeak-ng.exe','app/vendor/espeak-ng/libespeak-ng.dll']:
 p=root/relative;pe=pefile.PE(str(p));resolved=[]
 for imported in pe.DIRECTORY_ENTRY_IMPORT:
  name=imported.dll.decode();candidate=next((items[name.casefold()] for items in child_files if name.casefold() in items),None)
  if candidate is None:
   if name.casefold() not in system and not name.casefold().startswith(('api-ms-win-','ext-ms-win-')):private_errors.append({'file':relative,'unresolved':name})
   continue
  dependency=pefile.PE(str(candidate));exports={e.name for e in getattr(dependency,'DIRECTORY_ENTRY_EXPORT',type('Empty',(),{'symbols':[]})()).symbols if e.name};missing_symbols=[e.name.decode() for e in imported.imports if e.name and e.name not in exports]
  if dependency.FILE_HEADER.Machine!=pe.FILE_HEADER.Machine or missing_symbols:private_errors.append({'file':relative,'dependency':name,'machine_matches':dependency.FILE_HEADER.Machine==pe.FILE_HEADER.Machine,'missing_symbols':missing_symbols})
  resolved.append({'dependency':name,'path':candidate.relative_to(root).as_posix(),'machine':hex(dependency.FILE_HEADER.Machine),'named_import_symbols_checked':len([e for e in imported.imports if e.name]),'missing_symbols':missing_symbols});dependency.close()
 private_checked.append({'file':relative,'machine':hex(pe.FILE_HEADER.Machine),'resolved_private_imports':resolved});pe.close()
r['generic_child_search_paths']=[d.relative_to(root).as_posix() for d in child_roots];r['generic_private_import_checks']=private_checked;r['generic_private_import_errors']=private_errors;r['passed']=r['passed'] and not private_errors
(root.parent.parent/'audit/windows_pe.json').write_text(json.dumps(r,indent=2));print(json.dumps({'generic_child_private_imports_passed':not private_errors,'errors':private_errors}),flush=True)
if not r['passed']:raise RuntimeError('Static private import resolution failed')
