"""Independent CPU surface export with perspective-correct UVs and a depth buffer."""
import numpy as np
from .performance import camera_matrix

def render_surfaces(surfaces,width,height,camera):
    image=np.zeros((height,width,4),np.uint8);image[:]=[14,22,31,255];depth=np.full((height,width),np.inf,np.float32)
    matrix=camera_matrix(width,height,camera);light=np.array([-.4,.8,.6]);light/=np.linalg.norm(light)
    for surface in surfaces:
        xyz=surface['world_positions'];normal=surface['world_normals'];clip=np.c_[xyz,np.ones(len(xyz))]@matrix.T
        w=clip[:,3];ndc=np.divide(clip[:,:3],w[:,None],out=np.zeros_like(clip[:,:3]),where=np.abs(w[:,None])>1e-12)
        screen=np.c_[(ndc[:,0]+1)*width/2,(1-ndc[:,1])*height/2,ndc[:,2]]
        for face in surface['faces']:
            # The default shots keep the complete avatar beyond the near plane.
            # Fully/partly near-clipped triangles are skipped in CPU export only.
            if np.any(w[face]<=.05) or np.all(np.abs(ndc[face,0])>1) and np.all(np.sign(ndc[face,0])==np.sign(ndc[face[0],0])):continue
            a,b,c=screen[face];den=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
            if abs(den)<1e-9:continue
            if not surface['double_sided'] and den>=0:continue
            x0=max(0,int(np.floor(min(a[0],b[0],c[0]))));x1=min(width,int(np.ceil(max(a[0],b[0],c[0]))));y0=max(0,int(np.floor(min(a[1],b[1],c[1]))));y1=min(height,int(np.ceil(max(a[1],b[1],c[1]))))
            if x0>=x1 or y0>=y1:continue
            y,x=np.mgrid[y0:y1,x0:x1];x=x+.5;y=y+.5
            u=((b[0]-x)*(c[1]-y)-(b[1]-y)*(c[0]-x))/den;v=((c[0]-x)*(a[1]-y)-(c[1]-y)*(a[0]-x))/den;s=1-u-v
            z=u*a[2]+v*b[2]+s*c[2];valid=(u>=0)&(v>=0)&(s>=0)&(z>=-1)&(z<=1)&(z<depth[y0:y1,x0:x1])
            if not np.any(valid):continue
            bary=np.stack([u[valid],v[valid],s[valid]],axis=1)/w[face];bary/=bary.sum(axis=1,keepdims=True)
            n=bary@normal[face];n/=np.maximum(np.linalg.norm(n,axis=1,keepdims=True),1e-12)
            diffuse=np.maximum(0,n@light);shade=.32+.68*np.floor(diffuse*3)/3
            colour=np.tile(surface['colour'],(len(bary),1)).astype(float)
            if surface['texture'] is not None:
                uv=bary@surface['uv'][face];tex=surface['texture'];ix=np.minimum(tex.shape[1]-1,(uv[:,0]%1*tex.shape[1]).astype(int));iy=np.minimum(tex.shape[0]-1,(uv[:,1]%1*tex.shape[0]).astype(int));colour*=tex[iy,ix]/255
            colour[:,:3]*=shade[:,None];colour[:,:3]+=np.maximum(0,1-n[:,2])[:,None]*np.array([.025,.045,.065])
            if surface['alpha_mode']=='OPAQUE':colour[:,3]=1
            keep=np.ones(len(colour),bool) if surface['alpha_mode']!='MASK' else colour[:,3]>=surface['alpha_cutoff']
            yy,xx=np.where(valid);yy=yy[keep];xx=xx[keep];col=colour[keep]
            if surface['alpha_mode']=='BLEND':
                alpha=col[:,3:4];old=image[y0+yy,x0+xx,:3]/255;col[:,:3]=col[:,:3]*alpha+old*(1-alpha);col[:,3]=1
            image[y0+yy,x0+xx]=np.rint(np.clip(col,0,1)*255).astype(np.uint8);depth[y0+yy,x0+xx]=z[valid][keep]
    return image
