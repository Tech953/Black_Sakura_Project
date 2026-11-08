"""Build a self-contained player comparing production and the 720p60 baseline."""
import base64,json,math,sys
from pathlib import Path

project=Path(sys.argv[1]);output=Path(sys.argv[2]);baseline=Path(sys.argv[3]);target=Path(sys.argv[4])
read=lambda path:json.loads(path.read_text())
receipt=read(output/'render_receipt.json');report=read(output/'audit_report.json')
old=read(project/'render_validation.json')
def max_step(rows):
    hands=[r['hand'] for r in rows[::5]]
    return max(math.dist(a,b) for a,b in zip(hands,hands[1:]))
summary={'before':{'fps':60,'frames':720,'scheduled_body_drawings':23},'after':{'fps':60,'frames':720,'scheduled_body_drawings':23},
    'same_time_grid_12hz':{'before':{'maximum_hand_step_pixels':max_step(old['frame_evidence'])},'after':{'maximum_hand_step_pixels':max_step(receipt['frame_evidence'])}},
    'production_audit':report,'measurement_basis':'Common 12 Hz authored hand geometry in 1280 × 720 design coordinates. Compression PSNR compares encoded raster fidelity, not artistic quality.'}
data={'character':read(project/'integrations/character.original.json'),'profile':read(project/'integrations/reference_pack/manifest.json')['profiles'][0],
    'render':read(project/'integrations/synthetic_render.original.json'),'audio':read(project/'audio_envelope.json'),'actions':read(output/'action_timeline.json'),
    'before_actions':read(project/'action_timeline.json'),'audit':summary}
data['audio'].pop('values',None)
template=(project/'src/player.html').read_text()
template=template.replace('Rebecca · refined dialogue','Rebecca · production render review').replace('Rebecca · refined dialogue','Rebecca · production render review')
template=template.replace('A refined 12-second voiced sequence with clearer gesture spacing, more consistent face proportions, and staged blinks. Pause and switch versions to compare the same moment; frame controls inspect motion at 60 fps.',
    '1080p at 60 fps, rendered with 2× supersampling and mixed body exposures. Compare against the earlier 720p60 export at the same moment. Technical audits and artistic review are shown separately.')
template=template.replace("fps=version==='refined'?60:24","fps=60").replace("(which==='refined'?60:24)","60")
template=template.replace('Refined version','Production 1080p60').replace('Previous version','Previous 720p60')
template=template.replace('<button id="refined" class="secondary">Refined</button>','<button id="refined" class="secondary">Production</button>')
template=template.replace('<button id="baseline" class="secondary">Previous</button>','<button id="baseline" class="secondary">Previous 720p</button>')
template=template.replace('The refined sequence uses 23 body drawings, including eight new transitions.', 'The sequence uses the existing 23 scheduled drawings. Held body samples, continuous facial motion, camera framing and directional edge lights are separate layers.')
template=template.replace('<p id="status"', '<button id="next-flag" class="secondary" style="margin-top:12px">Next review flag</button><p id="flag-detail" class="small"></p><p id="status"')
quality=f"Technical checks: {report['passed']} passed, {report['failed']} failed. Artistic review pending. {len(report['review_flags'])} motion flags remain."
template=template.replace('<h2>Continuity audit</h2>',f'<h2>Render and continuity audit</h2><p class="small">{quality}</p>')
injected="""
 const flags=data.audit.production_audit.review_flags;
 $('flag-detail').textContent=flags.length+' review flags · anatomy and acting still require review';
 $('next-flag').addEventListener('click',()=>{video.pause();if(video.readyState<1){$('status').textContent='Loading movie metadata';return;}const frame=Math.floor((video.currentTime||0)*60+1e-6);const flag=flags.find(f=>f.frame>frame)||flags[0];if(!flag){$('flag-detail').textContent='No threshold flags; artistic review remains pending';return;}video.currentTime=flag.frame/60;$('flag-detail').textContent='Frame '+flag.frame+' · '+flag.kind+' · '+(flag.authored_pose_boundary?'Authored drawing boundary':'Within a pose');update();});
"""
template=template.replace("$('restart').addEventListener",injected+"$('restart').addEventListener")
template=template.replace('<meta name="viewport"','<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; media-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'"><meta name="viewport"')
encode=lambda p:base64.b64encode(p.read_bytes()).decode()
values={'POSTER_DATA':'data:image/png;base64,'+encode(output/'witnesses/frame_0352.png'),'VIDEO_DATA':'data:video/mp4;base64,'+encode(output/'Rebecca_Full_Voiced_Action.mp4'),
    'BEFORE_VIDEO_DATA':'data:video/mp4;base64,'+encode(baseline),'DATA_JSON':json.dumps(data).replace('<','\\u003c')}
for key,value in values.items():template=template.replace('/* '+key+' */',value)
assert '/* DATA_JSON */' not in template and report['failed']==0
target.parent.mkdir(parents=True,exist_ok=True);stage=target.with_suffix('.staged');stage.write_text(template);stage.replace(target)
print(json.dumps({'bytes':target.stat().st_size,'self_contained':True,'fps':60,'output':str(target)}))
