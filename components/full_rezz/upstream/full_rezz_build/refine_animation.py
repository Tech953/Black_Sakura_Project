from pathlib import Path
import shutil,json
ROOT=Path(__file__).resolve().parents[1];old=ROOT/'Rebecca_2D_Quality_Refinement';new=ROOT/'Rebecca_2D_60fps'
if not new.exists():shutil.copytree(old,new,ignore=shutil.ignore_patterns('frames','node_modules'))
before=new/'audit/before';before.mkdir(parents=True,exist_ok=True)
for a,b in [('exports/Rebecca_Full_Voiced_Action.mp4','movie.mp4'),('action_timeline.json','action_timeline.json'),('render_validation.json','render_validation.json'),('pose_model.json','pose_model.json')]:shutil.copy2(old/a,before/b)
p=new/'src/scene.js';s=p.read_text().replace('fps:24,frames:288','fps:60,frames:720').replace("[228,'b8','Invitation settle']\n];","[228,'b8','Invitation settle']\n].map(k=>[k[0]*2.5,k[1],k[2]]);").replace('Math.min(287,','Math.min(719,').replace('Math.floor(t*24','Math.floor(t*60')
a=s.index('function mouthStates(');b=s.index('function caption(',a)
s=s[:a]+'''function mouthStates(envelope){let drive=0,previous=0;const states=[],apertures=[];for(let i=0;i<720;i++){const t=i/60,a=amplitude(t,envelope),tau=a>drive?.045:.070;drive+=(a-drive)*(1-Math.exp(-1/60/tau));if(t<SPEC.speech_offset||t>=SPEC.speech_offset+envelope.duration_seconds){previous=0;drive=0;}else if(drive<.09)previous=0;else if(drive>.50||(previous===2&&drive>.30))previous=2;else previous=1;states.push(previous);apertures.push(previous?Math.max(.15,Math.min(1,.35+drive*.75)):0);}states.apertures=apertures;return states;}
function blink(t){for(const c of BLINKS){const d=t-(c-.125);if(d>=0&&d<.25){if(d<.075)return smooth(d/.075);if(d<.15)return 1;return 1-smooth((d-.15)/.1);}}return 0;}
''' +s[b:]
s=s.replace(':288,h=poses',':720,h=poses').replace('end-f>10','end-f>25').replace('i?f+4:f','i?f+10:f').replace('end-6','end-15').replace('f:287','f:719').replace('faceLayer(p,mouth,closedEyes)','faceLayer(p,mouth,closedEyes,aperture=mouth===1?.55:1)').replace('if(mouth===1){q.translate(0,e[1]);q.scale(1,.55);q.translate(0,-e[1]);}','q.translate(0,e[1]);q.scale(1,Math.max(.15,aperture));q.translate(0,-e[1]);').replace('if(closedEyes===.5){','if(closedEyes<1){').replace('e[3]+3);q.clip();','2*e[3]*closedEyes+2);q.clip();')
s=s.replace('mouths[Math.min(143,Math.floor(time*12+1e-8))]','mouths[Math.min(719,Math.floor(time*60+1e-8))]').replace('texture=faceLayer(p,mouth,b),target=curve.at(time*24)','aperture=mouths.apertures[Math.min(719,Math.floor(time*60+1e-8))]||0,texture=faceLayer(p,mouth,b,aperture),target=curve.at(time*60)').replace('mouth_state:mouth,blink:b','mouth_state:mouth,mouth_aperture:aperture,blink:b')
p.write_text(s)
p=new/'src/render.cjs';s=p.read_text().replace('length:288','length:720').replace('[0,17,58,116,123,127,133,141,149,157,171,183,195,207,225,252,287]','[0,43,145,290,308,318,333,353,373,393,428,458,488,518,563,630,719]').replace('i/24','i/60').replace('mouth_state:state.mouth_state,','mouth_state:state.mouth_state,mouth_aperture:state.mouth_aperture,').replace('288','720').replace('fps:24','fps:60').replace('k[0]%2===0','k[0]%5===0').replace('slice(228)','slice(570)').replace('two-frame exposure','one-twelfth-second exposure').replace('Three discrete mouth states','Continuous apertures and three mouth states')
s=s.replace("for(const value of [.5,1])assert.ok(evidence.some(x=>x.blink===value&&Math.abs(x.time_seconds-c)<.2))","{assert.ok(evidence.some(x=>x.blink>0&&x.blink<1&&Math.abs(x.time_seconds-c)<.2));assert.ok(evidence.some(x=>x.blink===1&&Math.abs(x.time_seconds-c)<.2));}")
s=s.replace(" const report=", " test('Continuous face and limb sampling produces more than 650 distinct frames and 100 mouth apertures',()=>{assert.ok(new Set(evidence.map(f=>f.pixel_sha256)).size>650);assert.ok(new Set(evidence.map(f=>f.mouth_aperture)).size>100)});\n const report=")
p.write_text(s)
for name in ['encode.cjs','check-exports.py']:
 p=new/'src'/name;s=p.read_text().replace('288','720').replace("'24'","'60'").replace('fps:24','fps:60').replace("'24/1'","'60/1'").replace('720p24','720p60');p.write_text(s)
p=new/'src/player.html';s=p.read_text().replace('24 fps','60 fps').replace('24fps','60fps').replace('const t=Math.max(0,Math.min(12,video.currentTime||0)),frame=Math.min(287,Math.floor(t*24+1e-6));',"const t=Math.max(0,Math.min(12,video.currentTime||0)),fps=version==='refined'?60:24,frame=Math.min(fps*12-1,Math.floor(t*fps+1e-6));").replace("+' / 287'","+' / '+(fps*12-1)+' · '+fps+' fps'").replace('Math.min(287/24,video.currentTime||0)',"Math.min(12-1/(which==='refined'?60:24),video.currentTime||0)").replace('const frame=Math.max(0,Math.min(287,Math.round((video.currentTime||0)*24)+direction));video.currentTime=frame/24;',"const fps=version==='refined'?60:24,frame=Math.max(0,Math.min(fps*12-1,Math.round((video.currentTime||0)*fps)+direction));video.currentTime=frame/fps;").replace('<title>','<title>FULL_REZZ · ')
p.write_text(s)
p=new/'src/check-player.cjs';s=p.read_text().replace('145/24','361/60').replace('287/24','719/60').replace('one 24fps','one 60fps').replace('/Invitation settle/','/Invitation transition/');p.write_text(s)
timeline=json.loads((new/'action_timeline.json').read_text());timeline['fps']=60
for key in timeline['keys']:key['frame']=int(key['frame']*2.5)
(new/'action_timeline.json').write_text(json.dumps(timeline,indent=2)+'\n')
p=new/'src/package-source.py';s=p.read_text().replace("'frames',", "'frames', 'node_modules',").replace("'frames'", "'frames'");p.write_text(s)
print(new)
