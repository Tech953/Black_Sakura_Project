from pathlib import Path
import json,numpy as np,shutil
ROOT=Path(__file__).resolve().parents[1];p=ROOT/'Rebecca_2D_60fps'
read=lambda s:json.loads((p/s).read_text());a=read('render_validation.json');b=read('audit/before/render_validation.json')
def metrics(frames):
 hands=np.array([x['hand'] for x in frames]);steps=np.linalg.norm(np.diff(hands,axis=0),axis=1);return {'maximum_hand_step_pixels':float(steps.max()),'mean_hand_step_pixels':float(steps.mean()),'path_pixels':float(steps.sum())}
audit={'program':'FULL_REZZ','schema_version':'4.0.0','scope':'60 fps sampling and continuity of the existing authored 23-drawing sequence','before':{'fps':24,'frames':288,'scheduled_body_drawings':len(set(x['pose_id'] for x in b['frame_evidence'])),'per_frame_geometry':metrics(b['frame_evidence'])},'after':{'fps':60,'frames':720,'scheduled_body_drawings':23,'distinct_rendered_frames':len(set(x['pixel_sha256'] for x in a['frame_evidence'])),'per_frame_geometry':metrics(a['frame_evidence']),'minimum_triangle_area_ratio':a['minimum_triangle_area_ratio'],'limited_arm_frames':a['limited_arm_frames'],'mouth':'60 Hz continuous aperture with 45/70 ms attack/release and discrete closed/half/open content','blinks':'75 ms close, 75 ms hold, 100 ms open; eased coverage'},'same_time_grid_12hz':{'samples':144,'before':metrics(b['frame_evidence'][::2]),'after':metrics(a['frame_evidence'][::5])},'measurement_limits':['Per-frame steps at different frame rates are not a percentage quality improvement.','Hand landmarks are authored geometry, not optical motion tracking.','More sampled frames do not add unseen body poses or prove anime fidelity.'],'actual_anime_motion_reference_available':False,'studio_equivalence_validated':False,'human_listening_review_performed':False,'phoneme_alignment_performed':False,'native_windows_tested':False}
(p/'audit/quality_audit.json').write_text(json.dumps(audit,indent=2)+'\n')
timeline=read('action_timeline.json');timeline.update({'fps':60,'name':'FULL_REZZ 60 fps dialogue continuity test','timing_basis':'Authored drawing changes every five 60 Hz frames; event seconds preserved from 24 fps baseline','lip_sync':'Continuous audio-energy aperture; no phoneme alignment'})
for key in timeline['keys']:key['time_seconds']=key['frame']/60
(p/'action_timeline.json').write_text(json.dumps(timeline,indent=2)+'\n')
m=read('manifest.json');m['fps']=60;m['nominal_frames']=720;m['program']='FULL_REZZ';m['native_windows_tested']=False
(p/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
text='''# FULL_REZZ - Rebecca 60 fps animation audit

The sequence renders 720 unique frames over 12 seconds at 1280 x 720, with 23 scheduled body drawings. Continuous aperture, eyelid coverage, breathing and bounded local arm motion are sampled at 60 Hz. The supplied synthetic statement remains unchanged at the 1.25-second offset.

The previous 24 fps sequence is retained for comparison. Body exposure event times remain the same; the new sampling does not invent sidesteps or unseen poses. Hand geometry is compared on a common 12 Hz time grid. Per-frame movement at different frame rates is not reported as a fidelity improvement percentage.

The renderer checks fixed declared foot contacts, bounded arm displacement, positive triangle orientation, isolated facial masks and all 720 frame hashes. Independent decoding checks MP4 frame count, duration, audio alignment, original PCM preservation, witness PNGs and exact reference-pack bytes. Player controls have simulated DOM/media tests; native Windows playback has not been tested.

## Limits

The supplied GIF-named references are single PNG drawings. Actual anime shot timing was unavailable. Some motion still reads as drawing substitution; AI-authored transition drawings retain anatomy and linework differences. This is a limited 2D demonstration, not Studio Trigger equivalence, full 3D reconstruction, arbitrary action generation, verified performer likeness, autonomous engram reasoning or phoneme-aligned speech.

See render_validation.json, export_validation.json, player_validation.json and audit/quality_audit.json for actual evidence. The baseline audit remains historical.
'''
(p/'Rebecca_Animation_Audit.md').write_text(text);(p/'README.md').write_text(text+'\nRender: node src/render.cjs; encode: node src/encode.cjs; check: python3 src/check-exports.py; player: node src/build-player.cjs and node src/check-player.cjs. Development uses @napi-rs/canvas and FFmpeg. Installed FULL_REZZ uses the bundled offline player.\n');(ROOT/'Rebecca_Animation_Audit.md').write_text(text)
pkg=read('package.json');pkg['version']='4.0.0';pkg['description']='FULL_REZZ 60 fps authored 2D dialogue test';(p/'package.json').write_text(json.dumps(pkg,indent=2)+'\n')
f=p/'src/package-source.py';s=f.read_text().replace("'frames' not in p.relative_to(root).parts", "not any(x in p.relative_to(root).parts for x in ('frames','node_modules'))");f.write_text(s)
shutil.copy2(p/'exports/Rebecca_Full_Voiced_Action.mp4',ROOT/'Rebecca_Full_Voiced_Action.mp4')
print(json.dumps(audit['after']))
