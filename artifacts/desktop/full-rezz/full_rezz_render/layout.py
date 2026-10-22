"""Authored geometry review against saved rasters; codec/audio auditing is separate."""
import base64,hashlib,html,json,math,os,re,tempfile
from pathlib import Path
from .geometry import Camera,vector,push_point,expected_zoom
from .project import Project,read_json,local_file,digest
from .timing import finite
LAYOUT_VERSION="1.0.0"

class Layout:
    def __init__(self,data):
        if not isinstance(data,dict) or set(data)!={"schema_version","canvas","provenance","camera","anchors","objects","background_regions","thresholds"} or data["schema_version"]!=LAYOUT_VERSION:raise ValueError("Unsupported or incomplete layout.")
        self.data=data;self.camera=Camera.from_dict(data["camera"],data["canvas"])
        if data["canvas"]!=[1280,720]:raise ValueError("Current cel review needs a 1280 × 720 guide.")
        p=data["provenance"]
        if not isinstance(p,dict) or set(p)!={"kind","metric_geometry_verified","notes"} or p["kind"]!="authored_guide" or type(p["metric_geometry_verified"]) is not bool or not isinstance(p["notes"],str) or len(p["notes"])>2000:raise ValueError("Declare guide provenance.")
        ids=set()
        def identity(row):
            name=row.get("id") if isinstance(row,dict) else None
            if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,48}",name) or name in ids:raise ValueError("Guide IDs must be unique portable labels.")
            ids.add(name)
        self.anchors=data["anchors"]
        if not isinstance(self.anchors,list) or len(self.anchors)!=2:raise ValueError("Two planted-contact anchors are required.")
        for row in self.anchors:
            identity(row)
            if set(row)!={"id","world","contact_index"} or type(row["contact_index"]) is not int or row["contact_index"] not in (0,1):raise ValueError("Invalid contact anchor.")
            vector(row["world"])
        if {a["contact_index"] for a in self.anchors}!={0,1}:raise ValueError("Both boots must be covered.")
        self.objects=data["objects"]
        if not isinstance(self.objects,list) or len(self.objects)>32:raise ValueError("At most 32 wireframes are permitted.")
        for row in self.objects:
            identity(row)
            if set(row)!={"id","vertices","edges"} or not isinstance(row["vertices"],list) or not 2<=len(row["vertices"])<=2048:raise ValueError("Invalid wireframe vertices.")
            for v in row["vertices"]:vector(v)
            if not isinstance(row["edges"],list) or not 1<=len(row["edges"])<=8192:raise ValueError("Invalid wireframe edges.")
            for edge in row["edges"]:
                if not isinstance(edge,list) or len(edge)!=2 or any(type(i) is not int or not 0<=i<len(row["vertices"]) for i in edge) or edge[0]==edge[1]:raise ValueError("Invalid edge indices.")
        self.regions=data["background_regions"]
        if not isinstance(self.regions,list) or not 1<=len(self.regions)<=12:raise ValueError("Declare one to twelve background regions.")
        for row in self.regions:
            identity(row)
            if set(row)!={"id","rect"}:raise ValueError("Unsupported region fields.")
            r=row["rect"]
            if not isinstance(r,list) or len(r)!=4 or any(type(x) is not int for x in r):raise ValueError("Invalid region rectangle.")
            x,y,w,h=r
            if x<0 or y<0 or w<40 or h<40 or x+w>1280 or y+h>720:raise ValueError("Region outside canvas or too small.")
        t=data["thresholds"]
        if not isinstance(t,dict) or set(t)!={"projection_error_design_pixels","background_mean_absolute_error_rgb","minimum_region_samples"}:raise ValueError("Declare every threshold.")
        finite(t["projection_error_design_pixels"],.01,2,"projection tolerance");finite(t["background_mean_absolute_error_rgb"],.1,12,"plate tolerance")
        if type(t["minimum_region_samples"]) is not int or not 16<=t["minimum_region_samples"]<=63:raise ValueError("Invalid sampling floor.")
    def svg(self,zoom=1.,pivot=(640,618)):
        e=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" role="img" aria-label="Authored geometry guide">']
        for obj in self.objects:
            for a,b in obj["edges"]:
                line=self.camera.segment(obj["vertices"][a],obj["vertices"][b])
                if line:
                    p,q=(push_point(x,zoom,pivot) for x in line)
                    e.append(f'<path d="M{p[0]:.4f},{p[1]:.4f} L{q[0]:.4f},{q[1]:.4f}" fill="none" stroke="#86ffce" stroke-width="2"/>')
        for a in self.anchors:
            p=push_point(self.camera.project(a["world"]),zoom,pivot)
            if p:e.append(f'<circle cx="{p[0]:.4f}" cy="{p[1]:.4f}" r="7" fill="none" stroke="#ffcc66" stroke-width="2"/>')
        for r in self.regions:
            x,y,w,h=r["rect"];p=push_point((x,y),zoom,pivot)
            e.append(f'<rect x="{p[0]:.4f}" y="{p[1]:.4f}" width="{w*zoom:.4f}" height="{h*zoom:.4f}" fill="none" stroke="#94b5ff" stroke-width="2"/>')
        return ''.join(e)+'</svg>'

def _area_reference(rgb):
    import numpy as np
    return np.pad(np.cumsum(np.cumsum(rgb.astype(np.float64),axis=0),axis=1),((1,0),(1,0),(0,0)))
def _area_values(integral,x,y):
    import numpy as np
    if np.any(x<0) or np.any(y<0) or np.any(x>integral.shape[1]-1) or np.any(y>integral.shape[0]-1):raise ValueError("Reference footprint leaves the image.")
    xx,yy=np.floor(x).astype(int),np.floor(y).astype(int);xn,yn=np.minimum(xx+1,integral.shape[1]-1),np.minimum(yy+1,integral.shape[0]-1)
    fx,fy=(x-xx)[:,None],(y-yy)[:,None]
    return integral[yy,xx]*(1-fx)*(1-fy)+integral[yy,xn]*fx*(1-fy)+integral[yn,xx]*(1-fx)*fy+integral[yn,xn]*fx*fy
def _background_error(reference,current,matte,region,zoom,pivot,area_reference=None):
    import numpy as np
    x,y,w,h=region;points=np.asarray([(xx,yy) for yy in np.linspace(y+5,y+h-5,7) for xx in np.linspace(x+5,x+w-5,9)],dtype=float)
    projected=np.asarray(pivot)+(points-np.asarray(pivot))*zoom;indices=np.rint(projected/10-.5).astype(int);mi=np.rint(projected/4-.5).astype(int)
    if np.any(indices<0) or np.any(indices[:,0]>=128) or np.any(indices[:,1]>=72) or np.any(mi<0) or np.any(mi[:,0]>=320) or np.any(mi[:,1]>=180):raise ValueError("Region leaves sampled canvas.")
    clear=np.array([not np.any(matte[max(0,yy-3):yy+4,max(0,xx-3):xx+4]) for xx,yy in mi]);actual=current[indices[clear,1],indices[clear,0]].astype(float)
    if area_reference is not None:
        scale=np.array([(area_reference.shape[1]-1)/1280,(area_reference.shape[0]-1)/720]);lo=(np.asarray(pivot)+(indices[clear]*10-np.asarray(pivot))/zoom)*scale;hi=(np.asarray(pivot)+((indices[clear]+1)*10-np.asarray(pivot))/zoom)*scale
        x0,y0=lo.T;x1,y1=hi.T
        expected=(_area_values(area_reference,x1,y1)-_area_values(area_reference,x0,y1)-_area_values(area_reference,x1,y0)+_area_values(area_reference,x0,y0))/((x1-x0)*(y1-y0))[:,None]
    else:
        inverse=np.asarray(pivot)+((indices[clear]+.5)*10-np.asarray(pivot))/zoom;q=inverse/10-.5;lo=np.floor(q).astype(int);frac=q-lo
        if np.any(lo<0) or np.any(lo[:,0]+1>=128) or np.any(lo[:,1]+1>=72):raise ValueError("Inverse region leaves reference.")
        xx,yy=lo.T;fx,fy=frac.T
        expected=reference[yy,xx]*(1-fx)[:,None]*(1-fy)[:,None]+reference[yy,xx+1]*fx[:,None]*(1-fy)[:,None]+reference[yy+1,xx]*(1-fx)[:,None]*fy[:,None]+reference[yy+1,xx+1]*fx[:,None]*fy[:,None]
    return (float(np.mean(np.abs(actual-expected))) if len(actual) else math.inf),int(np.count_nonzero(clear))

def analyze(project_root,render_directory,destination,movie=None):
    import numpy as np
    from .audit import read_rasters,_array
    from PySide6.QtGui import QImage
    rd=Path(render_directory).resolve();dest=Path(destination).resolve()
    if dest.exists():raise ValueError("Use a new review destination; existing results are preserved.")
    if dest.is_relative_to(Path(project_root).resolve()) or dest==rd:raise ValueError("Review must be outside the input project and render root.")
    source=local_file(project_root,"scene_layout.json");layout_hash=digest(source);layout=Layout(read_json(source));receipt=read_json(local_file(rd,"render_receipt.json"));receipt_hash=digest(rd/"render_receipt.json")
    project=Project(project_root,receipt["preset"],receipt["fps"]);frames=receipt["frame_evidence"];movie=Path(movie).resolve() if movie else local_file(rd,"Rebecca_Full_Voiced_Action.mp4")
    checks=[];metrics={};witnesses=[];cam=project.config["camera"];limits=layout.data["thresholds"]
    def require(condition,message):
        if not condition:raise ValueError(message)
    def check(name,fn):
        try:fn();checks.append({"name":name,"status":"passed"})
        except Exception as e:checks.append({"name":name,"status":"failed","detail":str(e)})
    def zoom(i):return expected_zoom(i,receipt["fps"],float(project.clock.duration),cam["push_fraction"])
    def inputs():
        require(project.assets==receipt["asset_sha256"] and project.config==receipt["config"],"Rendered input bytes/configuration differ.")
        require(len(frames)==project.clock.frames==receipt["frames"],"Incomplete frame evidence.")
        require(digest(movie)==receipt["output_sha256"]["Rebecca_Full_Voiced_Action.mp4"],"Movie bytes differ.")
        require(digest(local_file(rd,"raster_reference.zlib"))==receipt["output_sha256"]["raster_reference.zlib"],"Raster-reference bytes changed.")
        for i in receipt["witnesses"]:
            p=local_file(rd,f"witnesses/frame_{i:04d}.png");require(digest(p)==receipt["witness_sha256"][str(i)],"Witness bytes differ.");witnesses.append((i,p.read_bytes()))
    check("Layout review binds the original project, movie, receipt and witness bytes",inputs)
    def projections():
        maximum=0.
        for i,row in enumerate(frames):
            z=zoom(i);require(row["index"]==i and abs(row["time_seconds"]-i/receipt["fps"])<1e-10,"Frame grid differs.")
            require(row["camera_pivot"]==cam["pivot"] and abs(row["camera_zoom"]-z)<1e-10,"Unexpected camera transform.")
            for a in layout.anchors:
                p=push_point(layout.camera.project(a["world"]),z,cam["pivot"]);require(p is not None,"Contact anchor outside camera depth.")
                error=math.dist(p,row["screen_contacts"][a["contact_index"]]);maximum=max(maximum,error);require(error<=limits["projection_error_design_pixels"],f"Projected contact differs at frame {i}.")
        metrics.update(maximum_projected_contact_error_design_pixels=maximum,frames_checked=len(frames))
    check("Independent projection anchors agree with every expected shot-camera transform",projections)
    records=[]
    def support():
        for i,(rgb,matte) in enumerate(read_rasters(rd/"raster_reference.zlib",project.clock.frames)):
            row=frames[i];require(hashlib.sha256(rgb.tobytes()).hexdigest()==row["thumbnail_sha256"] and hashlib.sha256(matte.tobytes()).hexdigest()==row["actor_matte_sha256"],"Per-frame raster pixels differ.")
            for a in layout.anchors:
                p=push_point(layout.camera.project(a["world"]),zoom(i),cam["pivot"]);require(p is not None,"Contact cannot be projected.");x,y=round(p[0]/4),round(p[1]/4)
                require(2<=x<318 and 2<=y<180,"Boot outside contact raster.");require(float(np.mean(matte[y-2:y,x-2:x+3]))>200,f"Projected boot has no opaque raster support at frame {i}.")
            records.append((rgb,matte))
        require(len(records)==project.clock.frames,"Missing raster records.");metrics["projected_boot_support_observations"]=len(records)*len(layout.anchors)
    check("Every projected planted contact has actual opaque matte support",support)
    def background():
        require(len(records)==project.clock.frames,"Background review needs all raster records.");require(0 in receipt["witnesses"],"Frame-zero witness required.")
        first=_array(QImage(str(local_file(rd,"witnesses/frame_0000.png"))))[:,:,:3];require(hashlib.sha256(first.tobytes()).hexdigest()==frames[0]["raw_rgb_sha256"],"First raw witness pixels differ.");area=_area_reference(first);metrics["background_regions"]={}
        for r in layout.regions:
            errors=[];counts=[]
            for i,(rgb,matte) in enumerate(records):
                error,n=_background_error(records[0][0],rgb,matte,r["rect"],zoom(i),cam["pivot"],area);require(n>=limits["minimum_region_samples"],f"Occluded region {r['id']} at frame {i}; move the review region.");errors.append(error);counts.append(n)
            metrics["background_regions"][r["id"]]={"maximum_mean_absolute_error_rgb":max(errors),"mean_absolute_error_rgb":float(np.mean(errors)),"minimum_clear_samples":min(counts),"frames":len(errors)}
            require(max(errors)<=limits["background_mean_absolute_error_rgb"],f"Unexplained plate drift in {r['id']}.")
    check("All declared background regions follow the shot transform without unexplained plate drift",background)
    project.verify_unchanged();require(digest(source)==layout_hash and digest(rd/"render_receipt.json")==receipt_hash,"Layout or receipt changed during review.")
    report={"schema_version":LAYOUT_VERSION,"audit_engine":"full_rezz_render.layout","passed":sum(c["status"]=="passed" for c in checks),"failed":sum(c["status"]=="failed" for c in checks),"checks":checks,"metrics":metrics,"layout_sha256":layout_hash,"render_receipt_sha256":receipt_hash,"movie_sha256":receipt["output_sha256"]["Rebecca_Full_Voiced_Action.mp4"],"thresholds":limits,"provenance":layout.data["provenance"],"human_quality_review":"pending","studio_equivalence_validated":False,"measurement_limits":["Background prediction uses full-resolution frame-zero area averages against 128 × 72 RGB thumbnails: ten-design-pixel sampling, not full-resolution optical tracking.","Boot support uses 320 × 180 mattes: four-design-pixel sampling. Exact declared projection coordinates are separate from raster support.","This is an authored flat image-plane guide, not recovered metric scenery or game CAD. Perspective wireframes are guides, not generated animation.","This review binds the movie but does not repeat its full-resolution codec/audio audit, which remains separate.","Prop perspective, anatomy, acting, actual 3D occlusion and studio quality still need reference assets and human review."]}
    dest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".layout-review-",dir=dest.parent) as temporary:
        stage=Path(temporary)/"review";stage.mkdir();(stage/"scene_continuity_report.json").write_text(json.dumps(report,indent=2)+"\n");cards=[]
        for i,png in witnesses:
            svg=layout.svg(zoom(i),cam["pivot"]);(stage/f"guide_{i:04d}.svg").write_text(svg);cards.append(f'<article><h2>Frame {i} · {i/receipt["fps"]:.3f} s</h2><div class="frame"><img alt="Rendered witness at frame {i}" src="data:image/png;base64,{base64.b64encode(png).decode()}"/>{svg}</div></article>')
        document='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'"><title>FULL_REZZ geometry review</title><style>body{background:#101d23;color:#e7eceb;font:16px system-ui;margin:24px auto;max-width:1280px;padding:0 20px}h1,h2{font-weight:600}.frame{position:relative}.frame img{display:block;width:100%}.frame svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}pre{background:#162831;white-space:pre-wrap;overflow-wrap:anywhere;padding:18px}article{margin-bottom:30px}</style><h1>FULL_REZZ geometry review</h1><p>Authored flat image-plane guide · '+str(receipt['fps'])+' fps export unchanged · artistic approval pending.</p><p>Gold: projected boot contacts. Green: floor guide. Blue: sampled background regions. These checks do not establish studio-level quality.</p>'+''.join(cards)+'<h2>Continuity results</h2><pre>'+html.escape(json.dumps(report,indent=2))+'</pre></html>'
        (stage/"FULL_REZZ_Scene_Continuity_Review.html").write_text(document)
        if dest.exists():raise ValueError("Review destination appeared; preserving it.")
        os.rename(stage,dest)
    return {"passed":report["passed"],"failed":report["failed"],"frames_checked":metrics.get("frames_checked",0),"human_quality_review":"pending","report":str(dest/"scene_continuity_report.json"),"review":str(dest/"FULL_REZZ_Scene_Continuity_Review.html")}
