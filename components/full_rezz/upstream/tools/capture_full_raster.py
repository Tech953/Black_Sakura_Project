"""Reconstruct raw pixel evidence only if every frame matches its existing receipt."""
import hashlib,json,os,sys
from pathlib import Path
from full_rezz_render.project import Project,read_json
from full_rezz_render.scene import Scene,array
output=Path(sys.argv[2]);receipt=read_json(output/"render_receipt.json")
project=Project(sys.argv[1],receipt["preset"],receipt["fps"])
assert receipt["asset_sha256"]==project.assets and receipt["config"]==project.config
scene=Scene(project);target=Path(sys.argv[3]) if len(sys.argv)>3 else output/"full_resolution.rgb";target.parent.mkdir(parents=True,exist_ok=True);stage=target.with_suffix(".staged");hasher=hashlib.sha256()
try:
    with stage.open("wb") as stream:
        for index,row in enumerate(receipt["frame_evidence"]):
            raster,_,_,_=scene.render(index);pixels=array(raster)[:,:,:3].tobytes()
            assert hashlib.sha256(pixels).hexdigest()==row["raw_rgb_sha256"],f"Non-reproducible frame {index}"
            stream.write(pixels);hasher.update(pixels)
            if index%60==0:print(f"Captured {index+1}/{receipt['frames']}",flush=True)
        stream.flush();os.fsync(stream.fileno())
    project.verify_unchanged();os.replace(stage,target)
    receipt["full_resolution_reference"]={"name":"full_resolution.rgb","bytes":target.stat().st_size,"sha256":hasher.hexdigest(),"format":"RGB24, row-major frames","capture":"Re-rendered and matched every existing raw frame SHA256 before publication"}
    temporary=output/"render_receipt.json.staged";temporary.write_text(json.dumps(receipt,indent=2)+'\n');temporary.replace(output/"render_receipt.json")
    print(json.dumps(receipt["full_resolution_reference"]))
except BaseException:
    if stage.exists():stage.unlink()
    raise
