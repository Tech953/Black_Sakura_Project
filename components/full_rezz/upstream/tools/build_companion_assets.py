"""Build an original neutral rig and calibrated 2D views; preserve supplied cels."""
from pathlib import Path
import base64,json,math,shutil,sys
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1];APP=ROOT/'FULL_REZZ/app';sys.path.insert(0,str(APP))
from full_rezz_companion.gltf import SurfaceModel
from full_rezz_companion.performance import camera_matrix
from full_rezz_companion.raster import render_surfaces
OUT=APP/'character_assets';(OUT/'studio_unit').mkdir(parents=True,exist_ok=True);(OUT/'rebecca').mkdir(exist_ok=True)

def make_rig():
    names=['root','torso','head','jaw','right_shoulder','right_elbow','right_wrist','left_shoulder','left_elbow','left_wrist','left_hip','left_knee','left_ankle','right_hip','right_knee','right_ankle']
    parents=[None,0,1,2,1,4,5,1,7,8,1,10,11,1,13,14]
    translations=[[0,0,0],[0,.89,0],[0,.69,0],[0,.02,0],[.28,.50,0],[.21,-.24,0],[.10,-.26,.02],[-.28,.50,0],[-.21,-.24,0],[-.10,-.26,.02],[-.14,-.02,0],[0,-.38,0],[0,-.38,0],[.14,-.02,0],[0,-.38,0],[0,-.38,0]]
    nodes=[{'name':name,'translation':p,'children':[]} for name,p in zip(names,translations)]
    for i,parent in enumerate(parents):
        if parent is not None:nodes[parent]['children'].append(i)
    world=[]
    for i,p in enumerate(translations):world.append(np.asarray(p)+(world[parents[i]] if parents[i] is not None else 0))
    colours=[[.075,.105,.14,1],[.12,.72,.66,1],[.92,.78,.68,1],[.10,.20,.25,1],[.96,.31,.47,1],[.035,.055,.075,1],[.78,.96,.92,1]]
    materials=[{'name':n,'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':0,'roughnessFactor':1}} for n,c in zip(['charcoal','mint jacket','skin','boots','rose accents','mouth','eyes'],colours)]
    primitives=[];buffers=bytearray();views=[];accessors=[]
    def accessor(a,typ,component=5126):
        a=np.asarray(a,dtype={5126:'<f4',5123:'<u2',5125:'<u4'}[component]);padding=(-len(buffers))%4;buffers.extend(b'\0'*padding);start=len(buffers);buffers.extend(a.tobytes());views.append({'buffer':0,'byteOffset':start,'byteLength':a.nbytes})
        value={'bufferView':len(views)-1,'componentType':component,'count':len(a),'type':typ}
        if typ=='VEC3':value.update(min=a.min(axis=0).tolist(),max=a.max(axis=0).tolist())
        accessors.append(value);return len(accessors)-1
    def box(bounds,joint,material):
        x0,y0,z0,x1,y1,z1=bounds
        points=np.array([[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],float)
        faces=[[0,3,2],[0,2,1],[4,5,6],[4,6,7],[0,4,7],[0,7,3],[1,2,6],[1,6,5],[3,7,6],[3,6,2],[0,1,5],[0,5,4]]
        # Duplicate vertices per triangle to keep angular cel-style face normals.
        p=points[np.asarray(faces)].reshape(-1,3);n=np.cross(p[1::3]-p[::3],p[2::3]-p[::3]);n/=np.linalg.norm(n,axis=1,keepdims=True);n=np.repeat(n,3,axis=0)
        joints=np.zeros((len(p),4),np.uint16);joints[:,0]=joint;weights=np.zeros((len(p),4),np.float32);weights[:,0]=1
        primitives.append({'attributes':{'POSITION':accessor(p,'VEC3'),'NORMAL':accessor(n,'VEC3'),'JOINTS_0':accessor(joints,'VEC4',5123),'WEIGHTS_0':accessor(weights,'VEC4')},'material':material})
    box([-.21,.81,-.12,.21,.99,.13],1,0);box([-.25,.98,-.145,.25,1.44,.14],1,1)
    box([-.12,1.04,.142,.12,1.38,.15],1,0);box([-.16,.92,.134,.16,.97,.15],1,4)
    box([-.06,1.43,-.06,.06,1.61,.06],2,2)
    box([-.14,1.655,-.10,.14,1.81,.142],2,2);box([-.14,1.555,-.10,.14,1.654,.145],3,2)
    box([-.06,1.615,.14,.06,1.656,.151],2,5)
    box([-.175,1.735,-.145,.175,1.87,.07],2,4);box([-.185,1.56,-.16,-.143,1.80,.13],2,4);box([.143,1.56,-.16,.185,1.80,.13],2,4)
    box([-.145,1.61,-.165,.145,1.83,-.108],2,4);box([-.145,1.735,.144,.05,1.80,.16],2,4)
    box([-.09,1.699,.143,-.037,1.717,.155],2,6);box([.037,1.699,.143,.09,1.717,.155],2,6)
    box([-.066,1.698,.154,-.054,1.718,.161],2,5);box([.054,1.698,.154,.066,1.718,.161],2,5);box([-.018,1.661,.142,.018,1.689,.175],2,2)
    for sign,shoulder,elbow,wrist,hip,knee,ankle in [(1,4,5,6,13,14,15),(-1,7,8,9,10,11,12)]:
        lo,hi=sorted([sign*.24,sign*.47]);box([lo,1.13,-.08,hi,1.405,.095],shoulder,1)
        lo,hi=sorted([sign*.43,sign*.615]);box([lo,.89,-.07,hi,1.18,.105],elbow,1)
        lo,hi=sorted([sign*.535,sign*.66]);box([lo,.82,-.05,hi,.925,.10],wrist,2)
        x=sign*.14;box([x-.082,.49,-.095,x+.082,.91,.09],hip,0);box([x-.07,.11,-.08,x+.07,.51,.085],knee,0)
        box([x-.085,.015,-.11,x+.085,.145,.195],ankle,3);box([x-.09,.10,.088,x+.09,.16,.11],knee,4)
    inverse=[]
    for p in world:
        m=np.eye(4);m[:3,3]=-p;inverse.append(m.T.reshape(16))
    ib=accessor(inverse,'MAT4');nodes.append({'name':'surface','mesh':0,'skin':0});nodes[0]['children'].append(len(nodes)-1)
    # A small authored shoulder clip demonstrates actual glTF animation transport.
    times=accessor(np.array([[0],[.5],[1],[1.5],[2]]),'SCALAR');angles=[0,-.8,-1.05,-.8,0];rotations=accessor([[0,0,math.sin(a/2),math.cos(a/2)] for a in angles],'VEC4')
    doc={'asset':{'version':'2.0','generator':'FULL_REZZ original neutral Studio Unit rig'},'scene':0,'scenes':[{'nodes':[0]}],
         'nodes':nodes,'meshes':[{'primitives':primitives}],'materials':materials,'skins':[{'joints':list(range(16)),'inverseBindMatrices':ib,'skeleton':0}],
         'buffers':[{'byteLength':len(buffers),'uri':'data:application/octet-stream;base64,'+base64.b64encode(buffers).decode()}],
         'bufferViews':views,'accessors':accessors,'animations':[{'name':'authored_wave','samplers':[{'input':times,'output':rotations,'interpolation':'LINEAR'}],'channels':[{'sampler':0,'target':{'node':4,'path':'rotation'}}]}]}
    path=OUT/'studio_unit/studio_unit.gltf';path.write_text(json.dumps(doc,separators=(',',':')))
    mapping={name:i for i,name in enumerate(names)}
    return path,mapping,world

path,joints,world=make_rig();model=SurfaceModel.load(path);surface=model.surfaces();views=[]
for view_id,yaw,pitch in [('front',0,5),('front_three_quarter',45,5),('profile',90,5),('rear_three_quarter',145,5),('rear',180,5),('low_angle',-35,-15)]:
    camera={'azimuth_deg':yaw,'elevation_deg':pitch,'radius':3.1,'target_y':.95};rgba=render_surfaces(surface,640,640,camera);filename=f'studio_unit/{view_id}.png';Image.fromarray(rgba).save(OUT/filename)
    mouth=None
    if yaw in (0,45):
        q=camera_matrix(640,640,camera)@np.array([0,1.653,.155,1]);q=q[:3]/q[3];mouth=[float((q[0]+1)*320),float((1-q[1])*320),8,3.5]
    views.append({'view_id':view_id,'image':filename,'calibration_status':'calibrated','azimuth_deg':yaw,'elevation_deg':pitch,'mouth':mouth,'supported_actions':['idle','talk']})
value={'schema_version':'1.0.0','name':'Studio Unit','visual_role':'Original neutral rigged demonstration avatar; not a reconstructed anime character.',
       'two_d':{'views':views},'three_d':{'asset':'studio_unit/studio_unit.gltf','joint_mapping':joints,'supported_actions':['idle','talk','gesture','step']},
       'presentation':{'mode':'3d','view_id':'front'},'extensions':{'generation':'Procedural original meshes; 2D views rendered from those actual surfaces.'}}
(OUT/'studio_unit/character.json').write_text(json.dumps(value,indent=2)+'\n')
poses=json.loads((ROOT/'animation/project/pose_model.json').read_text())['poses']
pose=poses[0] if isinstance(poses,list) else poses['a1'];shutil.copy2(ROOT/'animation/project'/pose['base'],OUT/'rebecca/legacy_front.png')
value={'schema_version':'1.0.0','name':'Rebecca','visual_role':'Supplied authored 2D cel. No calibrated side/rear bank or 3D rig was supplied.',
       'two_d':{'views':[{'view_id':'supplied_view','image':'rebecca/legacy_front.png','calibration_status':'unmeasured','azimuth_deg':None,'elevation_deg':None,'mouth':pose['mouth'],'supported_actions':['idle','talk']}]},
       'three_d':None,'presentation':{'mode':'2d','view_id':'supplied_view'},'extensions':{'legacy_profile_ids_preserved':True,'hidden_view_generation':False}}
(OUT/'rebecca/character.json').write_text(json.dumps(value,indent=2)+'\n')
print(json.dumps({'model_triangles':model.triangle_count,'model_vertices':model.vertex_count,'calibrated_demo_views':len(views),'rebecca_views':1,'rebecca_three_d_available':False}))
