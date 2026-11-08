from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]/'FULL_REZZ/app'
def edit(name,pairs):
 p=ROOT/name;s=p.read_text(encoding='utf-8')
 for a,b in pairs:
  assert a in s,(name,a);s=s.replace(a,b)
 p.write_text(s,encoding='utf-8')
edit('voice_studio/engine.py',[
 ('from . import __version__','from . import offline, spectrum, __version__'),
 ('        self.profile(pid)\n        if provider',"        if offline.enabled():\n            raise ValueError('Offline mode: import a local reference document instead.')\n        self.profile(pid)\n        if provider"),
 ('"source_format": record.get("source_format", {}), **report}', '"source_format": record.get("source_format", {}), "spectral_balance": spectrum.measure(x[round(start * sr):round(end * sr)], sr), **report}'),
 ('"producer": "Voice Profile Studio"','"producer": "FULL_REZZ"'),
 ('        for profile in profiles:\n            refs =', '''        for profile in profiles:
            for iid in profile.get('portable_imports', []):
                if not re.fullmatch(r'import_[a-f0-9]{16}', iid):
                    raise ValueError('Invalid original import identifier.')
                src = self.root / 'original_imports' / iid
                if not src.is_dir():
                    raise ValueError('The original imported archive is missing.')
                shutil.copytree(src, directory / 'original_imports' / iid, dirs_exist_ok=True)
            refs =''')])
edit('voice_studio/quality.py',[('near = np.abs(x) >= (1 - 1 / 32768)','near = (np.abs(x) >= (1 - 1 / 32768)) & (np.abs(x) <= 1)')])
edit('voice_studio/audio.py',[('np.mean(np.abs(data) >= 0.999)','np.mean((np.abs(data) >= 0.999) & (np.abs(data) <= 1))')])
edit('voice_studio/__init__.py',[('__version__ = "1.2.0"','__version__ = "2.0.0"')])
edit('pyproject.toml',[('name = "voice-profile-studio"','name = "full-rezz"'),('version = "1.2.0"','version = "2.0.0"')])
edit('voice_studio/__main__.py',[('from .engine import Studio',"from . import offline\nif offline.enabled():\n    offline.activate()\n\nfrom .engine import Studio"),('Voice Profile Studio','FULL_REZZ')])
edit('voice_studio/server.py',[
 ('from . import __version__, models, research','from . import __version__, models, research, offline, portable_import, render_store'),
 ('                elif kind == "research":\n                    result = research.search_character(body["query"])', '''                elif kind == "render":
                    result = render_store.generate(studio, body)
                elif kind == "rebecca":
                    result = portable_import.restore(studio, WEB.parent.parent / 'examples' / 'Rebecca_Reference.zip')
                elif kind == "research":
                    if offline.enabled():
                        raise ValueError('Offline mode: import a local reference document.')
                    result = research.search_character(body["query"])'''),
 ('"capabilities": models.capabilities(), "jobs": jobs}', '"capabilities": models.capabilities(), "jobs": jobs, "renders": render_store.receipts(studio)}'),
 ('            elif path == "/api/state":', '''            elif path in ('/guide', '/quick-start', '/animation'):
                target = WEB.parent.parent / ('examples/Rebecca_60fps_Player.html' if path == '/animation' else 'docs/User_Guide.html' if path == '/guide' else 'docs/Quick_Start.html')
                self.send_file(target, 'text/html; charset=utf-8')
            elif re.fullmatch(r'/api/renders/render_[a-f0-9]{16}/(speech.wav|reference.wav|receipt.json)', path):
                _, _, _, rid, filename = path.split('/')
                target = render_store.directory(studio, rid) / filename
                self.send_file(target, 'audio/wav' if filename.endswith('.wav') else 'application/json', query.get('download', ['0'])[0] == '1')
            elif path == "/api/state":'''),
 ('            if path == "/api/import":', '''            if path == '/api/portable-import':
                with self.server.jobs_lock:
                    if any(j['status'] in ('queued', 'running') for j in self.server.jobs.values()):
                        raise ValueError('Wait for the processing task to finish.')
                    data = self.read_body(512 * 1024 * 1024)
                    with tempfile.TemporaryDirectory(dir=studio.root) as temp:
                        target = Path(temp) / 'upload.zip'
                        target.write_bytes(data)
                        self.json(portable_import.restore(studio, target), 201)
                return
            if path == "/api/import":'''),
 ('            if path == "/api/profiles":', '''            if path == '/api/render-review':
                self.json(render_store.review(studio, body['render_id'], body['status'], body.get('notes', '')))
            elif path == "/api/profiles":'''),
 ('Voice Profile Studio','FULL_REZZ')])
