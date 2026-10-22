"""Local glTF 2.0 triangle surfaces, textures, skins and animation clips.

Required extensions, Draco/meshopt compression and morph targets are rejected,
rather than silently displaying incomplete geometry.
"""
from __future__ import annotations
import base64, io, json, math, struct
from pathlib import Path
import numpy as np
from PIL import Image
from .characters import local_path

TYPES={5120:np.dtype('i1'),5121:np.dtype('u1'),5122:np.dtype('<i2'),5123:np.dtype('<u2'),5125:np.dtype('<u4'),5126:np.dtype('<f4')}
COUNTS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}

def quaternion_matrix(q):
    x,y,z,w=np.asarray(q,dtype=float); n=x*x+y*y+z*z+w*w
    if n<1e-12:raise ValueError('A node quaternion is zero.')
    s=2/n
    return np.array([[1-s*(y*y+z*z),s*(x*y-z*w),s*(x*z+y*w),0],
                     [s*(x*y+z*w),1-s*(x*x+z*z),s*(y*z-x*w),0],
                     [s*(x*z-y*w),s*(y*z+x*w),1-s*(x*x+y*y),0],[0,0,0,1]],dtype=float)

def z_rotation(angle):return [0,0,math.sin(angle/2),math.cos(angle/2)]

def transform(node):
    if 'matrix' in node:return np.asarray(node['matrix'],float).reshape(4,4).T
    m=quaternion_matrix(node.get('rotation',[0,0,0,1]));m[:3,:3]*=np.asarray(node.get('scale',[1,1,1]))[None,:]
    m[:3,3]=node.get('translation',[0,0,0]);return m

def slerp(a,b,t):
    a=np.asarray(a,float);b=np.asarray(b,float);a/=max(np.linalg.norm(a),1e-12);b/=max(np.linalg.norm(b),1e-12)
    dot=float(np.dot(a,b))
    if dot<0:b=-b;dot=-dot
    if dot>.9995:
        result=a+t*(b-a);return result/max(np.linalg.norm(result),1e-12)
    theta=math.acos(np.clip(dot,-1,1));return (math.sin((1-t)*theta)*a+math.sin(t*theta)*b)/math.sin(theta)

class SurfaceModel:
    def __init__(self, document, buffers, root):
        self.document=document;self.buffers=buffers;self.root=Path(root)
        if document.get('asset',{}).get('version')!='2.0' or document.get('extensionsRequired'):raise ValueError('Use uncompressed glTF 2.0 without required extensions.')
        self.nodes=document.get('nodes',[])
        if len(self.nodes)>4096:raise ValueError('The node count exceeds 4096.')
        self.parents={}
        for i,node in enumerate(self.nodes):
            for child in node.get('children',[]):
                if type(child) is not int or not 0<=child<len(self.nodes) or child in self.parents:raise ValueError('Invalid or multiply parented node.')
                self.parents[child]=i
        for i in range(len(self.nodes)):
            seen=set();j=i
            while j in self.parents:
                if j in seen or len(seen)>128:raise ValueError('Cyclic or excessively deep node tree.')
                seen.add(j);j=self.parents[j]
        self.skins=[]
        for skin in document.get('skins',[]):
            joints=skin.get('joints',[])
            if not joints or len(joints)>256 or len(joints)!=len(set(joints)) or any(type(j) is not int or not 0<=j<len(self.nodes) for j in joints):raise ValueError('A skin needs 1–256 valid joints.')
            inverse=self.accessor(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1) if 'inverseBindMatrices' in skin else np.tile(np.eye(4),(len(joints),1,1))
            if len(inverse)!=len(joints):raise ValueError('Skin inverse-bind count mismatch.')
            self.skins.append((joints,inverse))
        self.primitives=[];triangles=0;vertices=0
        scene_index=document.get('scene',0); scenes=document.get('scenes',[])
        roots=scenes[scene_index].get('nodes',[]) if scenes else [i for i in range(len(self.nodes)) if i not in self.parents]
        reachable=set();stack=list(roots)
        while stack:
            i=stack.pop()
            if type(i) is not int or not 0<=i<len(self.nodes):raise ValueError('Invalid scene node.')
            if i in reachable:continue
            reachable.add(i);stack.extend(self.nodes[i].get('children',[]))
        for node_index in sorted(reachable):
            node=self.nodes[node_index]
            if 'mesh' not in node:continue
            for primitive in document.get('meshes',[])[node['mesh']]['primitives']:
                if primitive.get('mode',4)!=4 or primitive.get('targets') or primitive.get('extensions'):raise ValueError('This renderer supports uncompressed triangles without morph targets.')
                attrs=primitive['attributes'];positions=self.accessor(attrs['POSITION']).astype(np.float32)
                if positions.ndim!=2 or positions.shape[1]!=3:raise ValueError('Positions must be VEC3.')
                indices=self.accessor(primitive['indices']).reshape(-1) if 'indices' in primitive else np.arange(len(positions))
                if not np.issubdtype(indices.dtype,np.integer) or len(indices)%3 or np.any(indices<0) or np.any(indices>=len(positions)):raise ValueError('Invalid triangle indices.')
                faces=indices.astype(np.uint32).reshape(-1,3)
                normals=self.accessor(attrs['NORMAL']).astype(np.float32) if 'NORMAL' in attrs else self.vertex_normals(positions,faces)
                uv=self.accessor(attrs['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in attrs else np.zeros((len(positions),2),np.float32)
                if normals.shape!=positions.shape or uv.shape!=(len(positions),2):raise ValueError('Normal/UV count mismatch.')
                material=document.get('materials',[])[primitive['material']] if 'material' in primitive else {}
                pbr=material.get('pbrMetallicRoughness',{});colour=np.asarray(pbr.get('baseColorFactor',[1,1,1,1]),np.float32)
                if colour.shape!=(4,) or not np.isfinite(colour).all():raise ValueError('Invalid base colour.')
                texture=None
                if 'baseColorTexture' in pbr:
                    ref=pbr['baseColorTexture']
                    if ref.get('texCoord',0)!=0 or ref.get('extensions'):raise ValueError('Use TEXCOORD_0 without texture transforms.')
                    entry=document['textures'][ref['index']];texture=self.image(document['images'][entry['source']])
                item={'node':node_index,'skin':node.get('skin'),'positions':positions,'normals':normals,'uv':uv,'faces':faces,
                      'colour':colour,'texture':texture,'double_sided':material.get('doubleSided',False),
                      'alpha_mode':material.get('alphaMode','OPAQUE'),'alpha_cutoff':material.get('alphaCutoff',.5)}
                if item['alpha_mode'] not in ('OPAQUE','MASK','BLEND'):raise ValueError('Invalid alpha mode.')
                if item['skin'] is not None:
                    if not 0<=item['skin']<len(self.skins) or 'JOINTS_0' not in attrs or 'WEIGHTS_0' not in attrs:raise ValueError('Skin attributes are missing.')
                    joints=self.accessor(attrs['JOINTS_0']);weights=self.accessor(attrs['WEIGHTS_0']).astype(np.float32)
                    if joints.shape!=(len(positions),4) or weights.shape!=joints.shape or np.any(joints<0) or np.any(joints>=len(self.skins[item['skin']][0])) or np.any(weights<0) or np.any(weights.sum(axis=1)<1e-9):raise ValueError('Invalid skin weights/joints.')
                    if 'JOINTS_1' in attrs:raise ValueError('This release supports four influences per vertex.')
                    item.update(joints=joints.astype(int),weights=weights/weights.sum(axis=1,keepdims=True))
                triangles+=len(faces);vertices+=len(positions);self.primitives.append(item)
        if not self.primitives or triangles>150_000 or vertices>300_000:raise ValueError('Provide triangle surfaces within the 150,000-triangle / 300,000-vertex limits.')
        self.triangle_count=triangles;self.vertex_count=vertices;self.animations=document.get('animations',[])
        for animation in self.animations:
            for channel in animation.get('channels',[]):
                target=channel['target'];sampler=animation['samplers'][channel['sampler']]
                if target.get('path') not in ('translation','rotation','scale') or 'matrix' in self.nodes[target['node']] or sampler.get('interpolation','LINEAR') not in ('LINEAR','STEP','CUBICSPLINE'):raise ValueError('Unsupported clip target or interpolation.')
                times=self.accessor(sampler['input']).reshape(-1)
                values=self.accessor(sampler['output'])
                factor=3 if sampler.get('interpolation')=='CUBICSPLINE' else 1
                if not len(times) or np.any(times<0) or np.any(np.diff(times)<=0) or len(values)!=len(times)*factor:raise ValueError('Invalid animation time/value counts.')
    @classmethod
    def load(cls,path):
        path=Path(path)
        if not 0<path.stat().st_size<=256*1024**2:raise ValueError('3D asset exceeds 256 MiB.')
        data=path.read_bytes();binary=None
        if path.suffix.lower()=='.glb':
            if len(data)<20 or struct.unpack_from('<4sII',data)!=(b'glTF',2,len(data)):raise ValueError('Invalid GLB header.')
            at=12;chunks=[]
            while at<len(data):
                if at+8>len(data):raise ValueError('Truncated GLB chunk.')
                size,kind=struct.unpack_from('<II',data,at);at+=8
                if size%4 or at+size>len(data):raise ValueError('Invalid GLB chunk bounds.')
                chunks.append((kind,data[at:at+size]));at+=size
            if not chunks or chunks[0][0]!=0x4e4f534a:raise ValueError('GLB JSON chunk must be first.')
            document=json.loads(chunks[0][1]);binary=next((b for k,b in chunks[1:] if k==0x004e4942),None)
        elif path.suffix.lower()=='.gltf':document=json.loads(data)
        else:raise ValueError('Choose glTF or GLB.')
        buffers=[]
        for i,buffer in enumerate(document.get('buffers',[])):
            uri=buffer.get('uri')
            value=cls.uri_bytes(uri,path.parent) if uri is not None else binary if i==0 else None
            if value is None or len(value)<buffer['byteLength'] or buffer['byteLength']>256*1024**2:raise ValueError('Missing or undersized glTF buffer.')
            buffers.append(value[:buffer['byteLength']])
        if sum(map(len,buffers))>512*1024**2:raise ValueError('Combined glTF buffers exceed 512 MiB.')
        return cls(document,buffers,path.parent)
    @staticmethod
    def uri_bytes(uri,root):
        if not isinstance(uri,str):raise ValueError('Invalid local asset URI.')
        if uri.startswith('data:'):
            if ';base64,' not in uri:raise ValueError('Use base64 data URIs.')
            return base64.b64decode(uri.split(',',1)[1],validate=True)
        return local_path(root,uri).read_bytes()
    def accessor(self,index):
        a=self.document['accessors'][index];dtype=TYPES.get(a['componentType']);components=COUNTS.get(a['type']);count=a['count']
        if dtype is None or components is None or type(count) is not int or not 0<count<=4_000_000:raise ValueError('Unsupported accessor type/count.')
        if 'bufferView' in a:
            view=self.document['bufferViews'][a['bufferView']];buffer=self.buffers[view['buffer']]
            start=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',dtype.itemsize*components)
            end=start+(count-1)*stride+dtype.itemsize*components
            if stride<dtype.itemsize*components or stride%dtype.itemsize or start<view.get('byteOffset',0) or end>view.get('byteOffset',0)+view['byteLength'] or end>len(buffer):raise ValueError('Accessor exceeds buffer-view bounds.')
            value=np.ndarray((count,components),dtype=dtype,buffer=buffer,offset=start,strides=(stride,dtype.itemsize)).copy()
        else:value=np.zeros((count,components),dtype=dtype)
        if 'sparse' in a:
            sparse=a['sparse'];n=sparse['count'];indices=sparse['indices'];values=sparse['values'];iv=self.document['bufferViews'][indices['bufferView']];vv=self.document['bufferViews'][values['bufferView']]
            idtype=TYPES.get(indices['componentType'])
            if indices['componentType'] not in (5121,5123,5125) or not 0<n<=count:raise ValueError('Invalid sparse accessor.')
            ix=np.frombuffer(self.buffers[iv['buffer']],idtype,n,iv.get('byteOffset',0)+indices.get('byteOffset',0))
            replace=np.frombuffer(self.buffers[vv['buffer']],dtype,n*components,vv.get('byteOffset',0)+values.get('byteOffset',0)).reshape(n,components)
            if np.any(ix>=count) or np.any(np.diff(ix.astype(np.int64))<=0):raise ValueError('Invalid sparse indices.')
            value[ix]=replace
        if a.get('normalized') and a['componentType']!=5126:
            limits=np.iinfo(dtype);value=value.astype(np.float32)/limits.max
            if limits.min<0:value=np.maximum(value,-1)
        if not np.isfinite(value).all():raise ValueError('Nonfinite glTF accessor.')
        return value
    def image(self,entry):
        if 'uri' in entry:data=self.uri_bytes(entry['uri'],self.root)
        else:
            view=self.document['bufferViews'][entry['bufferView']];at=view.get('byteOffset',0);data=self.buffers[view['buffer']][at:at+view['byteLength']]
        with Image.open(io.BytesIO(data)) as image:
            if image.width>4096 or image.height>4096:raise ValueError('Texture exceeds 4096 pixels per dimension.')
            return np.asarray(image.convert('RGBA')).copy()
    @staticmethod
    def vertex_normals(positions,faces):
        result=np.zeros_like(positions);p=positions[faces];normal=np.cross(p[:,1]-p[:,0],p[:,2]-p[:,0])
        for k in range(3):np.add.at(result,faces[:,k],normal)
        length=np.linalg.norm(result,axis=1,keepdims=True);return np.divide(result,length,out=np.zeros_like(result),where=length>1e-12)
    def local_nodes(self,time=0,clip=None,overrides=None):
        nodes=[dict(n) for n in self.nodes]
        if clip is not None:
            if type(clip) is not int or not 0<=clip<len(self.animations):raise ValueError('Clip unavailable.')
            animation=self.animations[clip]
            for channel in animation['channels']:
                sampler=animation['samplers'][channel['sampler']];times=self.accessor(sampler['input']).reshape(-1);values=self.accessor(sampler['output']);path=channel['target']['path']
                local=float(time%times[-1]) if times[-1]>0 else 0;i=int(np.clip(np.searchsorted(times,local,side='right')-1,0,len(times)-1));j=min(i+1,len(times)-1);dt=float(times[j]-times[i]);t=(local-times[i])/dt if dt else 0;method=sampler.get('interpolation','LINEAR')
                if method=='STEP':value=values[i]
                elif method=='CUBICSPLINE':
                    a,b=values[3*i+1],values[3*j+1];value=(2*t**3-3*t*t+1)*a+(t**3-2*t*t+t)*dt*values[3*i+2]+(-2*t**3+3*t*t)*b+(t**3-t*t)*dt*values[3*j]
                    if path=='rotation':value/=max(np.linalg.norm(value),1e-12)
                else:value=slerp(values[i],values[j],t) if path=='rotation' else values[i]*(1-t)+values[j]*t
                nodes[channel['target']['node']][path]=value
        for index,fields in (overrides or {}).items():
            if type(index) is not int or not 0<=index<len(nodes) or 'matrix' in nodes[index]:raise ValueError('Performance mapping needs a valid TRS node.')
            nodes[index].update(fields)
        return nodes
    def world_matrices(self,time=0,clip=None,overrides=None):
        local=self.local_nodes(time,clip,overrides);world={}
        def get(i):
            if i not in world:world[i]=(get(self.parents[i]) if i in self.parents else np.eye(4))@transform(local[i])
            return world[i]
        return [get(i) for i in range(len(local))]
    def surfaces(self,time=0,clip=None,overrides=None):
        world=self.world_matrices(time,clip,overrides);out=[]
        for p in self.primitives:
            point=np.c_[p['positions'],np.ones(len(p['positions']))];normal=p['normals']
            if p['skin'] is None:
                matrix=world[p['node']];positions=(point@matrix.T)[:,:3];normals=normal@np.linalg.inv(matrix[:3,:3])
            else:
                joint_nodes,inverse=self.skins[p['skin']];matrices=np.asarray([world[j]@m for j,m in zip(joint_nodes,inverse)])
                selected=matrices[p['joints']];positions=np.einsum('nvij,nj,nv->ni',selected,point,p['weights'])[:,:3]
                normal_matrices=np.linalg.inv(matrices[:,:3,:3]).transpose(0,2,1)
                normals=np.einsum('nvij,nj,nv->ni',normal_matrices[p['joints']],normal,p['weights'])
            length=np.linalg.norm(normals,axis=1,keepdims=True);normals=np.divide(normals,length,out=np.zeros_like(normals),where=length>1e-12)
            out.append(dict(p,world_positions=positions.astype(np.float32),world_normals=normals.astype(np.float32)))
        return out
