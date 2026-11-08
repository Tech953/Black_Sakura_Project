"""Static PE evidence only; Windows loader and device execution are separate."""
from pathlib import Path
import argparse,struct,json,hashlib
def inspect(p):
 data=p.read_bytes()
 if data[:2]!=b'MZ':raise ValueError('Not a PE executable: '+str(p))
 offset=struct.unpack_from('<I',data,0x3c)[0]
 if data[offset:offset+4]!=b'PE\0\0':raise ValueError('Missing PE signature: '+str(p))
 machine,sections=struct.unpack_from('<HH',data,offset+4);optional_size=struct.unpack_from('<H',data,offset+20)[0];opt=offset+24;magic=struct.unpack_from('<H',data,opt)[0]
 directory=opt+(112 if magic==0x20b else 96);import_rva,import_size=struct.unpack_from('<II',data,directory+8);table=opt+optional_size;regions=[]
 for i in range(sections):
  o=table+40*i;virtual_size,virtual_address,raw_size,raw_pointer=struct.unpack_from('<IIII',data,o+8);regions.append((virtual_address,max(virtual_size,raw_size),raw_pointer,raw_size))
 def physical(rva):
  for start,size,raw,raw_size in regions:
   if start<=rva<start+size:
    pos=raw+rva-start
    if rva-start>=raw_size or pos>=len(data):raise ValueError('PE import lies outside raw section')
    return pos
  raise ValueError('PE import RVA is unmapped')
 imports=[]
 if import_rva:
  current=physical(import_rva)
  for i in range(4096):
   values=struct.unpack_from('<IIIII',data,current+20*i)
   if not any(values):break
   pos=physical(values[3]);end=data.find(b'\0',pos,min(pos+512,len(data)))
   if end<0:raise ValueError('PE import name is unterminated')
   imports.append(data[pos:end].decode('ascii'))
  else:raise ValueError('Unbounded PE import table')
 return {'machine':hex(machine),'x64':machine==0x8664,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'imported_DLLs':imports}
def main():
 a=argparse.ArgumentParser();a.add_argument('--payload',required=True);a.add_argument('--output',required=True);args=a.parse_args();root=Path(args.payload);out=[]
 for p in sorted(root.rglob('*')):
  if p.is_file() and p.suffix.lower() in ('.exe','.dll','.pyd'):
   result=inspect(p);result['path']=p.relative_to(root).as_posix();out.append(result)
 templates={'python/Lib/site-packages/OpenGL/DLLS/'+name+'.'+vc+'.dll' for name in ['freeglut32','gle32'] for vc in ['vc9','vc10','vc14']}
 templates.update('python/Lib/site-packages/setuptools/'+name+'.exe' for name in ['cli-32','cli-arm64','cli','gui-32','gui-arm64','gui'])
 non_x64=[x for x in out if not x['x64']]
 unexpected=[x['path'] for x in non_x64 if x['path'] not in templates]
 report={'PE_files_checked':len(out),'application_and_all_Python_extensions_x64':not unexpected,'unused_wheel_platform_templates':[{k:x[k] for k in ('path','machine','sha256')} for x in non_x64 if x['path'] in templates],'unexpected_non_x64':unexpected,'all_import_tables_parsed':True,'native_windows_loader_execution_tested':False,'system_and_dynamic_DLL_closure_verified':False,'files':out}
 Path(args.output).write_text(json.dumps(report,indent=2)+'\n');assert out and not unexpected,'Unexpected non-x64 application binary';print(json.dumps({k:v for k,v in report.items() if k not in ('files','unused_wheel_platform_templates')},indent=2))
if __name__=='__main__':main()
