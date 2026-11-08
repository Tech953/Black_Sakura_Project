"""Inspect normal/delay PE imports; no claim of native execution."""
import json,mmap,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;BASE=Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'windows_bundle'
def inspect(path):
 with path.open('rb') as file,mmap.mmap(file.fileno(),0,access=mmap.ACCESS_READ) as data:
  u16=lambda p:struct.unpack_from('<H',data,p)[0];u32=lambda p:struct.unpack_from('<I',data,p)[0];u64=lambda p:struct.unpack_from('<Q',data,p)[0]
  if data[:2]!=b'MZ':return None
  pe=u32(60)
  if data[pe:pe+4]!=b'PE\0\0':raise ValueError('Invalid PE header '+str(path))
  machine=u16(pe+4);count=u16(pe+6);optional=pe+24;magic=u16(optional);base=u64(optional+24) if magic==0x20b else u32(optional+28);dirs=optional+(112 if magic==0x20b else 96);sections=[]
  start=optional+u16(pe+20)
  for i in range(count):
   p=start+i*40;sections.append((u32(p+12),max(u32(p+8),u32(p+16)),u32(p+20)))
  def offset(rva):
   for virtual,size,raw in sections:
    if virtual<=rva<virtual+size:return raw+rva-virtual
   if rva<start:return rva
   raise ValueError('Unmapped PE address')
  def string(rva):
   p=offset(rva);end=data.find(b'\0',p,p+1024);return data[p:end].decode('ascii').lower()
  imports=[];delays=[]
  rva=u32(dirs+8)
  if rva:
   p=offset(rva)
   for i in range(1000):
    q=p+i*20
    if not any(data[q:q+20]):break
    imports.append(string(u32(q+12)))
  rva=u32(dirs+13*8)
  if rva:
   p=offset(rva)
   for i in range(1000):
    q=p+i*32
    if not any(data[q:q+32]):break
    attrs=u32(q);name=u32(q+4);delays.append(string(name if attrs&1 else name-base))
  return {'path':path.relative_to(BASE).as_posix(),'machine':hex(machine),'imports':sorted(set(imports)),'delay_imports':sorted(set(delays))}
SYSTEM=set('advapi32.dll avrt.dll bcrypt.dll cabinet.dll cfgmgr32.dll clbcatq.dll comctl32.dll comdlg32.dll crypt32.dll cryptbase.dll cryptsp.dll d2d1.dll d3d11.dll d3d12.dll d3d9.dll dbghelp.dll dbgcore.dll dhcpcsvc.dll dnsapi.dll dcomp.dll dinput8.dll dwrite.dll dwmapi.dll dxgi.dll dxva2.dll evr.dll gdi32.dll glu32.dll hid.dll imm32.dll iphlpapi.dll kernel32.dll kernelbase.dll ksuser.dll mf.dll mfplat.dll mfreadwrite.dll mfuuid.dll mpr.dll msacm32.dll msasn1.dll msimg32.dll msvcrt.dll mswsock.dll ncrypt.dll netapi32.dll normaliz.dll ntdll.dll ole32.dll oleacc.dll oleaut32.dll opengl32.dll powrprof.dll propsys.dll psapi.dll quartz.dll rasapi32.dll rpcrt4.dll secur32.dll setupapi.dll shcore.dll shell32.dll shlwapi.dll strmiids.dll ucrtbase.dll urlmon.dll user32.dll userenv.dll usp10.dll uxtheme.dll version.dll vfw32.dll winhttp.dll wininet.dll winmm.dll winspool.drv wintrust.dll wldap32.dll ws2_32.dll wtsapi32.dll wmvcore.dll '.split())
SYSTEM.update('authz.dll winscard.dll bthprops.cpl fontsub.dll pdh.dll winusb.dll imagehlp.dll uiautomationcore.dll d3dcompiler_47.dll avicap32.dll bcryptprimitives.dll combase.dll'.split())
available={p.name.lower() for p in BASE.rglob('*') if p.is_file()}
entries=[];missing=[];optional=[]
for path in sorted(BASE.rglob('*')):
 if not path.is_file() or path.suffix.lower() not in ('.dll','.pyd','.exe'):continue
 entry=inspect(path)
 if entry is None:continue
 entries.append(entry)
 for name in entry['imports']+entry['delay_imports']:
  if name in SYSTEM or name in available or name.startswith(('api-ms-win-','ext-ms-')):continue
  item={'file':entry['path'],'dependency':name}
  if '/sqldrivers/' in entry['path'] or 'torio/lib/_torio_ffmpeg' in entry['path'] or 'torio/lib/libtorio_ffmpeg' in entry['path'] or 'numba/np/ufunc/tbbpool' in entry['path']:optional.append(item)
  else:missing.append(item)
result={'program':'FULL_REZZ','binary_files':len(entries),'x64_files':sum(x['machine']=='0x8664' for x in entries),'non_x64_files':[x['path'] for x in entries if x['machine']!='0x8664'],'missing_active_dependencies':missing,'unused_optional_dependencies':optional,'native_windows_execution_tested':False,'method':'PE normal and delay import names compared with bundled files and explicit Windows system DLLs; this does not prove runtime loader resolution or GUI execution.','entries':entries}
(ROOT/'pe_dependencies.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='entries'},indent=2));assert not missing,'Unresolved active imports'
