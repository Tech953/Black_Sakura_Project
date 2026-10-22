"""Optional direct backend for an isolated offline worker with the bundled runtime.

Do not instantiate this in a Replit web-server process: offline.activate() is process-wide.
"""
from __future__ import annotations
import importlib
import sys
from pathlib import Path
from .contracts import ContractError, read_json, speech_body

class RuntimeUnavailable(RuntimeError):
    pass

class LocalRuntime:
    def __init__(self, app_root, project_root):
        self.app_root = Path(app_root).resolve(); self.project_root = Path(project_root).resolve(); self._lock = None
        if not (self.app_root / "voice_studio" / "offline.py").is_file():
            raise RuntimeUnavailable("Supply the installed FULL_REZZ app directory.")
        if self.project_root.is_relative_to(self.app_root):
            raise ContractError("Keep user project data outside the application directory.")
        sys.path.insert(0, str(self.app_root))
        package = importlib.import_module("voice_studio")
        if not Path(package.__file__).resolve().is_relative_to(self.app_root) or package.__version__ not in ("2.0.0","3.0.0"):
            raise RuntimeUnavailable("The worker must load the specified FULL_REZZ 2.0 or 3.0 application.")
        self.version=package.__version__
        offline = importlib.import_module("voice_studio.offline"); offline.activate()
        try:
            lock_class = importlib.import_module("voice_studio.project_lock").ProjectLock
            self._lock = lock_class(self.project_root)
            self.studio = importlib.import_module("voice_studio.engine").Studio(self.project_root)
            if self.version=='3.0.0':
                self._runtime=importlib.import_module('voice_studio.runtime');self._runtime.enforce_offline()
                self._manager=importlib.import_module('voice_studio.synthesis').RenderManager(self.studio)
            else:self._render_store=importlib.import_module('voice_studio.render_store')
            self._offline = offline
        except Exception as exc:
            self.close()
            raise RuntimeUnavailable("Open with the bundled interpreter and dependencies; close any app using this project. " + str(exc)) from exc

    def render(self, body):
        if not isinstance(body, dict): raise ContractError("Render request body must be an object.")
        if any(not isinstance(k, str) for k in body) or not {"profile_id", "text"} <= set(body): raise ContractError("Render body requires profile_id and text.")
        unknown = set(body) - {"profile_id", "text", "style", "rate", "pitch", "volume", "steps", "seed", "reference_text", "scene_notes", "quality_policy"}
        if unknown: raise ContractError("Unknown render request options: " + ", ".join(sorted(unknown)))
        validated = speech_body(**body)
        if self.version=='3.0.0':
            if any(validated.get(k,0) for k in ('pitch','volume')) or validated.get('reference_text') or validated.get('scene_notes'):raise ContractError('Legacy pitch, volume and reference overrides are unsupported by the 3.0 renderer.')
            if not self._runtime.health(True)['passed']:raise RuntimeUnavailable('Installed model or resource verification failed.')
            return self._manager.generate(pid=validated['profile_id'],text=validated['text'],style=validated.get('style','neutral'),rate=validated.get('rate',1),steps=validated.get('steps',32),seed=validated.get('seed',42))
        self._offline.verify_models()
        return self._render_store.generate(self.studio, validated)

    def review(self, render_id, status, notes=""):
        if self.version=='3.0.0':
            if status not in ('accepted','rejected','unreviewed'):raise ContractError('Unsupported legacy review status.')
            from voice_studio.engine import write_json,now
            audit=self._manager.get(render_id);audit.setdefault('legacy_review_history',[]).append({'at':now(),'status':status,'notes':notes,'does_not_approve_five_listening_ratings':True});write_json(self._manager.path(render_id)/'audit.json',audit);return audit
        return self._render_store.review(self.studio, render_id, status, notes)

    def import_pack(self, archive):
        if self.version=="3.0.0":raise ContractError("Use the 3.0 voice SDK or editable workspace restore for native profile imports.")
        from voice_studio.portable_import import restore
        return restore(self.studio, Path(archive))

    def close(self):
        if self._lock is not None: self._lock.close(); self._lock = None

    def __enter__(self): return self
    def __exit__(self, *args): self.close()
