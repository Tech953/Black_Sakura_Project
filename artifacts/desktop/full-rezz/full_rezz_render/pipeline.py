"""One offline job: render, audit, retain findings and release temporary pixels."""
import shutil
from pathlib import Path
from .render import render
from .audit import audit

def process(project_root,output_directory,preset="production",fps=60,progress=None,ffmpeg=None,ffprobe=None):
    result=render(project_root,output_directory,preset,fps,progress)
    raw=Path(result["raw_reference_path"])
    try:
        findings=audit(project_root,output_directory,ffmpeg,ffprobe,str(raw))
        if (Path(project_root)/"scene_layout.json").exists():
            from .layout import analyze
            layout=analyze(project_root,output_directory,Path(output_directory)/"layout_review")
            findings["scene_continuity"]=layout;findings["failed"]+=layout["failed"]
            if layout["failed"]:findings["technical_status"]="failed"
        return {**{k:v for k,v in result.items() if k!="raw_reference_path"},**findings,"temporary_raster_released":True}
    finally:
        # This exact directory was created by this render job, outside user projects.
        shutil.rmtree(raw.parent)
