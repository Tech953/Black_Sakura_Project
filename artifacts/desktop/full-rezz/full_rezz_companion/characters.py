"""Stable profile bindings, verified local assets and explicit supported views."""
from __future__ import annotations
import copy, hashlib, json, math, os, re, shutil, stat, tempfile, uuid, zipfile
from pathlib import Path, PurePosixPath
from .history import HistoryStore

ASSETS = Path(__file__).resolve().parents[1] / "character_assets"

def local_path(root, name):
    if not isinstance(name,str) or not name or "\\" in name or ":" in name or name.startswith("/") or any(p in (".","..","") for p in name.split("/")):
        raise ValueError("Asset references must be safe relative paths.")
    root=Path(root).resolve(); path=root/name
    if any((root/Path(*PurePosixPath(name).parts[:i])).is_symlink() for i in range(1,len(PurePosixPath(name).parts)+1)) or not path.resolve().is_relative_to(root) or not path.is_file():
        raise ValueError("Character asset is missing or unsafe: "+name)
    return path

def validate_manifest(value, root, profile_id):
    if not isinstance(value,dict) or value.get("schema_version")!="1.0.0": raise ValueError("Use character format 1.0.0.")
    if value.get("profile_id",profile_id)!=profile_id: raise ValueError("Character format belongs to a different voice profile.")
    value=copy.deepcopy(value);value["profile_id"]=profile_id
    views=value.get("two_d",{}).get("views",[]); view_ids=set()
    if not isinstance(views,list) or len(views)>64: raise ValueError("Use at most 64 authored 2D views.")
    for view in views:
        if not isinstance(view,dict) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",view.get("view_id","")) or view["view_id"] in view_ids:raise ValueError("2D view identifiers must be unique.")
        view_ids.add(view["view_id"]); local_path(root,view["image"])
        if view.get("calibration_status") not in ("calibrated","unmeasured"):raise ValueError("Declare the view calibration status.")
        for key in ("azimuth_deg","elevation_deg"):
            angle=view.get(key)
            if angle is not None and (type(angle) not in (int,float) or not -360<=angle<=360):raise ValueError("Invalid view angle.")
        parts=view.get('parts',[]);seen=set()
        if not isinstance(parts,list) or len(parts)>256:raise ValueError('Use at most 256 authored parts per view.')
        if parts and not view.get('base_excludes_animated_parts'):raise ValueError('Part rigs require a base image excluding animated parts.')
        for part in parts:
            local_path(root,part['image'])
            if not isinstance(part.get('part_id'),str) or part['part_id'] in seen or part.get('parent') is not None and part['parent'] not in seen:raise ValueError('Part IDs must be unique and parents declared first.')
            for key in ('pivot','position'):
                if not isinstance(part.get(key),list) or len(part[key])!=2 or any(type(n) not in (int,float) or not math.isfinite(n) for n in part[key]):raise ValueError('Parts need finite pivots and local positions.')
            if type(part.get('rest_rotation_deg',0)) not in (int,float) or not math.isfinite(part.get('rest_rotation_deg',0)):raise ValueError('Part rotation must be finite.')
            seen.add(part['part_id'])
        if view.get("mouth") is not None and (len(view["mouth"])!=4 or any(type(n) not in (int,float) for n in view["mouth"])):raise ValueError("Mouth region needs four numeric coordinates.")
    three=value.get("three_d")
    if three is not None:
        if not isinstance(three,dict):raise ValueError("3D representation must be an object.")
        path=local_path(root,three["asset"])
        from .gltf import SurfaceModel
        model=SurfaceModel.load(path)
        for joint,index in three.get('joint_mapping',{}).items():
            if not isinstance(joint,str) or type(index) is not int or not 0<=index<len(model.nodes) or 'matrix' in model.nodes[index]:raise ValueError('Joint mappings need supported TRS node indices.')
    if not views and three is None:raise ValueError("Provide actual 2D artwork or a supported 3D surface model.")
    return value

class CharacterRepository:
    def __init__(self, root):
        self.root=Path(root)/"companion";self.characters=self.root/"characters";self.characters.mkdir(parents=True,exist_ok=True)
        self.assets=self.root/"assets";self.assets.mkdir(exist_ok=True)
    def path(self,pid):HistoryStore.valid_id(pid);return self.characters/(pid+".json")
    def save(self,value):
        path=self.path(value["profile_id"]); stage=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
        stage.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False),encoding="utf-8");os.replace(stage,path);return value
    def asset_root(self, value):
        pack=value.get("asset_pack","bundled")
        if pack=="bundled":return ASSETS
        if not re.fullmatch(r"[a-f0-9]{64}",pack):raise ValueError("Invalid asset pack.")
        return self.assets/pack
    def get(self,pid):
        value=json.loads(self.path(pid).read_text(encoding="utf-8"));validate_manifest(value,self.asset_root(value),pid);return value
    def ensure_profile(self, profile):
        pid=profile["id"]
        if self.path(pid).is_file():return self.get(pid)
        # Character names are not identity evidence. Until the operator imports
        # authored views for this exact profile, use only the neutral demo asset.
        template=ASSETS/"studio_unit/character.json"
        if not template.is_file():raise ValueError("Bundled character assets are missing.")
        value=json.loads(template.read_text(encoding="utf-8"));value.update(profile_id=pid,name=profile["name"],asset_pack="bundled")
        value["visual_role"]="Explicit neutral demonstration avatar; not a likeness of the bound character."
        return self.save(validate_manifest(value,ASSETS,pid))
    def select(self,pid,mode,view_id=None):
        value=self.get(pid)
        if mode not in ("2d","3d"):raise ValueError("Choose 2D or 3D.")
        if mode=="3d" and value.get("three_d") is None:raise ValueError("3D is unavailable for this character. Import an actual rigged surface model.")
        if mode=="2d":
            views=value.get("two_d",{}).get("views",[])
            if not views:raise ValueError("2D is unavailable. Import authored view images.")
            view_id=view_id or views[0]["view_id"]
            if view_id not in {v["view_id"] for v in views}:raise ValueError("This viewpoint has no supplied artwork; no hidden fallback was selected.")
        value["presentation"]={"mode":mode,"view_id":view_id};self.save(value);return value
    def import_pack(self,pid,path):
        HistoryStore.valid_id(pid);path=Path(path)
        if path.stat().st_size>256*1024**2:raise ValueError("Character ZIP exceeds 256 MiB.")
        with path.open("rb") as file:sha=hashlib.file_digest(file,"sha256").hexdigest()
        dest=self.assets/sha
        with tempfile.TemporaryDirectory(dir=self.assets) as t:
            stage=Path(t)
            with zipfile.ZipFile(path) as z:
                infos=z.infolist();names=[i.filename for i in infos]
                if len(names)!=len(set(names)) or len(names)>10000 or sum(i.file_size for i in infos)>512*1024**2 or "character.json" not in names:raise ValueError("Character ZIP is duplicate, oversized or missing character.json.")
                for i in infos:
                    name=i.filename.rstrip("/")
                    if "\\" in name or ":" in name or name.startswith("/") or any(p in ("",".","..") for p in name.split("/")) or stat.S_ISLNK(i.external_attr>>16):raise ValueError("Unsafe character ZIP member.")
                z.extractall(stage)
            value=json.loads((stage/"character.json").read_text(encoding="utf-8"));value=validate_manifest(value,stage,pid);value["asset_pack"]=sha
            value["source_archive_sha256"]=sha;value.setdefault("extensions",{})
            if not dest.exists():shutil.copytree(stage,dest)
            self.save(value)
        return value
