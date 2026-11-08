"""Bundled text inference and explicit host adapters; no separate model service."""
from __future__ import annotations
import ctypes, hashlib, json, os, re, signal, struct, subprocess, tempfile, time
from pathlib import Path

APP_ROOT=Path(__file__).resolve().parents[1]

def gguf_architecture(path):
    path=Path(path)
    with path.open('rb') as file:
        def take(n):
            if n>4*1024**2:raise ValueError('GGUF metadata field exceeds the limit.')
            value=file.read(n)
            if len(value)!=n:raise ValueError('Truncated GGUF metadata.')
            return value
        def number(fmt):return struct.unpack(fmt,take(struct.calcsize(fmt)))[0]
        def string():return take(number('<Q')).decode('utf-8')
        if take(4)!=b'GGUF' or number('<I') not in (2,3):raise ValueError('Choose a supported GGUF text model.')
        tensors=number('<Q');fields=number('<Q')
        if not 1<=tensors<=100000 or fields>10000:raise ValueError('GGUF counts are invalid.')
        def value(kind,depth=0):
            if depth>2:raise ValueError('GGUF metadata nesting exceeds the limit.')
            sizes={0:1,1:1,2:2,3:2,4:4,5:4,6:4,7:1,10:8,11:8,12:8}
            if kind==8:return string()
            if kind==9:
                element=number('<I');count=number('<Q')
                if count>2_000_000:raise ValueError('GGUF metadata array exceeds the limit.')
                if element in sizes:
                    skip=count*sizes[element]
                    if file.tell()+skip>path.stat().st_size:raise ValueError('Truncated GGUF array.')
                    file.seek(skip,1);return None
                for _ in range(count):value(element,depth+1)
                return None
            if kind not in sizes:raise ValueError('Unsupported GGUF metadata type.')
            return take(sizes[kind])
        architecture=None
        for _ in range(fields):
            key=string();kind=number('<I');result=value(kind)
            if key=='general.architecture':architecture=result
        if not isinstance(architecture,str):raise ValueError('GGUF has no text-model architecture.')
        if architecture in ('clip','vision','mmproj','whisper','wavtokenizer') or 'mmproj' in path.name.casefold():
            raise ValueError('This is a projector or non-text GGUF. Select the main text model; an mmproj file cannot generate chat replies.')
        return architecture

def linux_parent_exit():
    if os.name!='nt' and hasattr(signal,'SIGTERM'):
        libc=ctypes.CDLL(None)
        if hasattr(libc,'prctl'):libc.prctl(1,signal.SIGTERM)
        if os.getppid()==1:os._exit(1)

class LlamaProvider:
    def __init__(self,model=None,binary=None,timeout=180):
        self.model=Path(model or Path(os.environ.get('VOICE_STUDIO_MODEL_ROOT',str(APP_ROOT/'models')))/'companion/qwen2.5-0.5b-instruct-q4_k_m.gguf')
        self.binary=Path(binary or os.environ.get('FULL_REZZ_LLAMA_COMPLETION',str(APP_ROOT/'vendor/llama-cpp/llama-completion.exe')))
        self.timeout=timeout
    def reply(self,messages):
        if not self.model.is_file() or not self.binary.is_file():raise ValueError('The bundled chat engine/model is missing. Install the complete FULL_REZZ package or configure a host adapter.')
        architecture=gguf_architecture(self.model)
        if architecture!='qwen2':raise ValueError('The bundled template supports Qwen2-family text models. Configure a host adapter for other model families.')
        stat_before=self.model.stat();model_sha256=hashlib.file_digest(self.model.open('rb'),'sha256').hexdigest()
        if architecture!='qwen2':raise ValueError('This release runs Qwen2-family text GGUFs directly. Use a registered host adapter for a different chat template; projector files are unsupported.')
        # The bundled Qwen model uses its published ChatML template. Imported
        # history is quoted data in the current user turn, never new system policy.
        prompt=''.join('<|im_start|>'+m['role']+'\n'+m['content']+'<|im_end|>\n' for m in messages)+'<|im_start|>assistant\n'
        started=time.monotonic()
        with tempfile.TemporaryDirectory(prefix='full-rezz-dialogue-') as t:
            file=Path(t)/'prompt.txt';file.write_text(prompt,encoding='utf-8')
            command=[str(self.binary),'-m',str(self.model),'-f',str(file),'-c','8192','-n','128','-t','4','-tb','4',
                     '--no-display-prompt','--simple-io','--no-warmup','-b','128','-ub','32','--seed','42','--temp','0.65','-r','<|im_end|>']
            env=os.environ.copy();env['PATH']=str(self.binary.parent)+os.pathsep+env.get('PATH','')
            stdout=Path(t)/'stdout.txt';stderr=Path(t)/'stderr.txt';out_file=stdout.open('wb');err_file=stderr.open('wb')
            options={'cwd':str(self.binary.parent),'env':env,'stdin':subprocess.DEVNULL,'stdout':out_file,'stderr':err_file}
            if os.name=='nt':options['creationflags']=subprocess.CREATE_NO_WINDOW
            else:options['preexec_fn']=linux_parent_exit
            process=subprocess.Popen(command,**options)
            try:
                while process.poll() is None:
                    if time.monotonic()-started>self.timeout:raise TimeoutError('Local text generation timed out.')
                    if stdout.stat().st_size>128*1024 or stderr.stat().st_size>1024**2:raise ValueError('Local text generation exceeded its output limit.')
                    time.sleep(.02)
            except BaseException:
                process.kill();process.wait();raise
            finally:out_file.close();err_file.close()
            if stdout.stat().st_size>128*1024 or stderr.stat().st_size>1024**2:raise ValueError('Local text output exceeded its limit.')
            out=stdout.read_bytes()
            if process.returncode:raise ValueError('Local text inference failed. Verify the model and CPU compatibility; no reply was invented.')
        text=out.decode('utf-8',errors='strict');text=re.sub(r'\x1b\[[0-9;]*m','',text)
        text=text.split('<|im_end|>',1)[0].replace('[end of text]','').split('> EOF by user',1)[0].strip()
        if not text or len(text)>12000:raise ValueError('The text model returned an empty or oversized reply.')
        if (stat_before.st_size,stat_before.st_mtime_ns)!=(self.model.stat().st_size,self.model.stat().st_mtime_ns):raise ValueError('The text model changed during inference; the reply was not accepted.')
        return {'text':text,'provider':'bundled_llama_cpp','model_architecture':architecture,'elapsed_seconds':time.monotonic()-started,
                'model_file':self.model.name,'model_sha256':model_sha256,'seed':42,'context_tokens':8192,'maximum_output_tokens':128,'network_inference':False,'generation_performed':True}

class HostProvider:
    def __init__(self,callback):
        if not callable(callback):raise ValueError('A host dialogue adapter must be callable.')
        self.callback=callback
    def reply(self,messages):
        value=self.callback(messages)
        if isinstance(value,str):value={'text':value}
        if not isinstance(value,dict) or not isinstance(value.get('text'),str) or not 1<=len(value['text'].strip())<=12000:raise ValueError('Host adapter needs a nonempty reply of at most 12,000 characters.')
        return dict(value,provider='host_adapter')

class ArchiveProvider:
    """Explicit reference lookup, for inspecting history without text inference."""
    def reply(self,messages):
        body=messages[-1]['content'];context=json.loads(body.split('\nCURRENT_REQUEST\n',1)[0])
        stored=[m for m in context.get('saved_excerpts',[]) if m['role']=='assistant']
        text=('Saved conversation excerpt: '+stored[-1]['content'][:600]) if stored else 'No matching assistant excerpt is stored yet. Import a conversation or choose the local text model to generate a new reply.'
        return {'text':text,'provider':'archive_lookup','generation_performed':False,'network_inference':False}
