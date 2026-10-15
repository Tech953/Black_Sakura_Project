"""Offline 3D wireframe projection; guides do not create character artwork."""
from dataclasses import dataclass
import math
from .timing import finite

def vector(value, label="vector"):
    if not isinstance(value,list) or len(value)!=3:raise ValueError(f"{label} needs three coordinates.")
    return tuple(finite(x,-1e6,1e6,label) for x in value)
def sub(a,b):return tuple(x-y for x,y in zip(a,b))
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def unit(a):
    n=math.sqrt(dot(a,a))
    if n<1e-9:raise ValueError("Camera axes must be nonzero and nonparallel.")
    return tuple(x/n for x in a)

@dataclass(frozen=True)
class Camera:
    """Right-handed world, y-up; pixels start at upper left; depth is forward."""
    projection:str
    eye:tuple
    right:tuple
    up:tuple
    forward:tuple
    near:float
    far:float
    width:int
    height:int
    vertical:float
    @classmethod
    def from_dict(cls,data,canvas):
        if not isinstance(data,dict):raise ValueError("Camera must be an object.")
        mode=data.get("projection")
        if mode not in ("orthographic","perspective"):raise ValueError("Unsupported projection.")
        k="vertical_span" if mode=="orthographic" else "vertical_fov_degrees"
        if set(data)!={"projection","eye","target","up","near","far",k}:raise ValueError("Unsupported or incomplete camera fields.")
        if not isinstance(canvas,list) or len(canvas)!=2 or any(type(x) is not int or not 16<=x<=3840 for x in canvas):raise ValueError("Invalid canvas.")
        eye=vector(data["eye"]);forward=unit(sub(vector(data["target"]),eye));right=unit(cross(forward,unit(vector(data["up"]))));up=unit(cross(right,forward))
        near=finite(data["near"],1e-5,1e6,"near plane");far=finite(data["far"],1e-5,1e6,"far plane")
        if far<=near:raise ValueError("Far plane must be beyond near plane.")
        vertical=finite(data[k],.01,1e6 if mode=="orthographic" else 170,k)
        return cls(mode,eye,right,up,forward,near,far,*canvas,vertical)
    def coordinates(self,point):
        p=sub(vector(list(point)),self.eye)
        return dot(p,self.right),dot(p,self.up),dot(p,self.forward)
    def _project(self,q):
        s=self.height/self.vertical if self.projection=="orthographic" else self.height/(2*math.tan(math.radians(self.vertical)/2)*q[2])
        return self.width/2+q[0]*s,self.height/2-q[1]*s
    def project(self,point):
        q=self.coordinates(point)
        return self._project(q) if self.near<=q[2]<=self.far else None
    def segment(self,a,b):
        a,b=self.coordinates(a),self.coordinates(b);lo,hi=0.,1.;dz=b[2]-a[2]
        if abs(dz)<1e-12:
            if not self.near<=a[2]<=self.far:return None
        else:
            t0,t1=(self.near-a[2])/dz,(self.far-a[2])/dz;lo,hi=max(lo,min(t0,t1)),min(hi,max(t0,t1))
            if lo>hi:return None
        p,q=(self._project(tuple(x+(y-x)*t for x,y in zip(a,b))) for t in (lo,hi));dx,dy=q[0]-p[0],q[1]-p[1];lo,hi=0.,1.
        for direction,distance in [(-dx,p[0]),(dx,self.width-p[0]),(-dy,p[1]),(dy,self.height-p[1])]:
            if abs(direction)<1e-12:
                if distance<0:return None
            elif direction<0:lo=max(lo,distance/direction)
            else:hi=min(hi,distance/direction)
            if lo>hi:return None
        return tuple((p[0]+dx*t,p[1]+dy*t) for t in (lo,hi))

def push_point(point,zoom,pivot):
    return None if point is None else tuple(pivot[i]+zoom*(point[i]-pivot[i]) for i in (0,1))
def expected_zoom(index,fps,duration,push):
    x=min(1.,max(0.,index/fps/duration));return 1+push*x*x*(3-2*x)
