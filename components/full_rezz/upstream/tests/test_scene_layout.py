"""Projection, clipping and adverse registration cases."""
import copy,json,math,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from full_rezz_render.geometry import Camera,expected_zoom
from full_rezz_render.layout import Layout
ROOT=Path(__file__).resolve().parents[1]
def camera(mode="perspective"):
    d={"projection":mode,"eye":[0,0,5],"target":[0,0,0],"up":[0,1,0],"near":1,"far":10}
    d.update({"vertical_fov_degrees":90} if mode=="perspective" else {"vertical_span":10});return d

class ProjectionTests(unittest.TestCase):
    def test_perspective_center_y_direction_and_depth_scaling(self):
        c=Camera.from_dict(camera(),[1280,720]);self.assertEqual(c.project([0,0,0]),(640,360));self.assertAlmostEqual(c.project([1,0,0])[0],712);self.assertAlmostEqual(c.project([1,0,-5])[0],676);self.assertLess(c.project([0,1,0])[1],360)
    def test_orthographic_size_does_not_change_with_depth(self):
        c=Camera.from_dict(camera("orthographic"),[1280,720]);self.assertEqual(c.project([1,1,0]),c.project([1,1,-5]))
    def test_rotated_camera_uses_its_own_axes(self):
        d=camera();d['eye']=[5,0,0];c=Camera.from_dict(d,[1280,720]);self.assertEqual(c.project([0,0,0]),(640,360));self.assertLess(c.project([0,0,1])[0],640)
    def test_behind_camera_near_and_far_are_rejected(self):
        c=Camera.from_dict(camera(),[1280,720])
        for p in [[0,0,6],[0,0,4.5],[0,0,-6]]:self.assertIsNone(c.project(p))
    def test_depth_crossing_segment_is_clipped_before_division(self):
        c=Camera.from_dict(camera(),[1280,720]);line=c.segment([.1,0,6],[.1,0,0]);self.assertIsNotNone(line)
        for x,y in line:self.assertTrue(math.isfinite(x) and math.isfinite(y))
        self.assertAlmostEqual(line[0][0],676)
    def test_fully_hidden_or_offscreen_segments_are_rejected(self):
        c=Camera.from_dict(camera(),[1280,720]);self.assertIsNone(c.segment([0,0,6],[1,0,7]));self.assertIsNone(c.segment([100,100,0],[110,110,0]))
    def test_viewport_crossing_segment_is_clipped(self):
        c=Camera.from_dict(camera(),[1280,720]);line=c.segment([-100,0,0],[100,0,0]);self.assertAlmostEqual(line[0][0],0);self.assertAlmostEqual(line[1][0],1280)
    def test_degenerate_camera_and_nonfinite_values_are_rejected(self):
        for change in [{'target':[0,0,5]},{'up':[0,0,1]},{'near':11},{'far':True},{'vertical_fov_degrees':180},{'eye':[math.nan,0,5]}]:
            d=camera();d.update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):Camera.from_dict(d,[1280,720])
    def test_extra_projection_fields_and_wrong_canvas_are_rejected(self):
        d=camera();d['vertical_span']=10
        with self.assertRaises(ValueError):Camera.from_dict(d,[1280,720])
        with self.assertRaises(ValueError):Camera.from_dict(camera(),[True,720])
    def test_delivery_rate_preserves_the_camera_path(self):
        self.assertAlmostEqual(expected_zoom(300,60,12,.018),expected_zoom(600,120,12,.018));self.assertEqual(expected_zoom(0,60,12,.018),1)

class GuideBoundaryTests(unittest.TestCase):
    def setUp(self):self.data=json.loads((ROOT/'animation/project/scene_layout.json').read_text())
    def test_authored_flat_layout_projects_both_registered_boots(self):
        l=Layout(self.data)
        for anchor,x in zip(l.anchors,[546.72,733.28]):
            p=l.camera.project(anchor['world']);self.assertAlmostEqual(p[0],x);self.assertAlmostEqual(p[1],618)
        self.assertIn('viewBox="0 0 1280 720"',l.svg())
    def test_bad_edges_duplicate_contacts_or_external_fields_are_rejected(self):
        for kind in ['edge','contact','extra','identity','region','threshold']:
            d=copy.deepcopy(self.data)
            if kind=='edge':d['objects'][0]['edges'][0]=[0,999]
            elif kind=='contact':d['anchors'][1]['contact_index']=0
            elif kind=='extra':d['external_url']='https://example.com'
            elif kind=='identity':d['anchors'][0]['id']='<script>'
            elif kind=='region':d['background_regions'][0]['rect']=[-1,0,80,80]
            else:d['thresholds']['background_mean_absolute_error_rgb']=100
            with self.subTest(kind=kind),self.assertRaises(ValueError):Layout(d)
try:
    import numpy as np
    import av,PySide6
    from full_rezz_render.layout import analyze,_background_error,_area_reference,_area_values
    RASTER=True
except ImportError:RASTER=False

@unittest.skipUnless(RASTER,'Optional raster dependencies are not installed')
class RegistrationTests(unittest.TestCase):
    def test_full_reference_area_prediction_handles_fractional_pixels(self):
        rgb=np.repeat(np.array([[0.,10.],[20.,30.]])[:,:,None],3,axis=2);a=_area_reference(rgb)
        area=_area_values(a,np.array([1.5]),np.array([1.5]))-_area_values(a,np.array([.5]),np.array([1.5]))-_area_values(a,np.array([1.5]),np.array([.5]))+_area_values(a,np.array([.5]),np.array([.5]));np.testing.assert_allclose(area,[[15,15,15]])
    def test_process_automatically_retains_scene_continuity_results(self):
        from test_render_strength import OfflineIntegrationTests
        from full_rezz_render.pipeline import process
        f=OfflineIntegrationTests;f.setUpClass()
        try:
            (f.project/'scene_layout.json').write_text(json.dumps(json.loads((ROOT/'animation/project/scene_layout.json').read_text())))
            with patch('socket.getaddrinfo',side_effect=AssertionError('Network forbidden')),patch('socket.create_connection',side_effect=AssertionError('Network forbidden')):r=process(f.project,f.base/'processed-layout','preview',120)
            self.assertEqual(r['failed'],0);self.assertEqual(r['scene_continuity']['passed'],4);self.assertEqual(r['scene_continuity']['frames_checked'],60);self.assertTrue(r['temporary_raster_released'])
        finally:f.tearDownClass()
    def test_background_sampling_detects_an_unexplained_plate_change(self):
        y,x=np.mgrid[:72,:128];rgb=np.stack([x,y,x+y],axis=2).astype(np.uint8);matte=np.zeros((180,320),np.uint8)
        e,n=_background_error(rgb,rgb,matte,[100,200,120,80],1,[640,618]);self.assertEqual(e,0);self.assertEqual(n,63)
        changed=rgb.copy();changed[20:32,10:24]+=30;e,n=_background_error(rgb,changed,matte,[100,200,120,80],1,[640,618]);self.assertGreater(e,20)
    def test_occluded_background_regions_cannot_claim_alignment(self):
        rgb=np.zeros((72,128,3),np.uint8);matte=np.full((180,320),255,np.uint8);e,n=_background_error(rgb,rgb,matte,[100,200,120,80],1,[640,618]);self.assertEqual(n,0);self.assertTrue(math.isinf(e))
    def test_independent_camera_projection_detects_changed_receipt(self):
        import shutil
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);shutil.copytree(ROOT/'animation/render_evidence',p/'evidence');shutil.copytree(ROOT/'animation/project',p/'project');d=json.loads((p/'evidence/render_receipt.json').read_text());d['frame_evidence'][5]['camera_zoom']+=.1;(p/'evidence/render_receipt.json').write_text(json.dumps(d))
            with patch('socket.getaddrinfo',side_effect=AssertionError('Network forbidden')),patch('socket.create_connection',side_effect=AssertionError('Network forbidden')):r=analyze(p/'project',p/'evidence',p/'review',ROOT/'animation/Rebecca_Full_Voiced_Action.mp4')
            report=json.loads(Path(r['report']).read_text());self.assertTrue(any(c['status']=='failed' and 'projection' in c['name'].lower() for c in report['checks']))
            with self.assertRaises(ValueError):analyze(p/'project',p/'evidence',p/'review',ROOT/'animation/Rebecca_Full_Voiced_Action.mp4')
    def test_shifted_contact_anchor_cannot_pass_declared_or_raster_checks(self):
        import shutil
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);shutil.copytree(ROOT/'animation/project',p/'project');d=json.loads((p/'project/scene_layout.json').read_text());d['anchors'][0]['world'][0]=50;(p/'project/scene_layout.json').write_text(json.dumps(d));r=analyze(p/'project',ROOT/'animation/render_evidence',p/'review',ROOT/'animation/Rebecca_Full_Voiced_Action.mp4');report=json.loads(Path(r['report']).read_text());fail=[c['name'] for c in report['checks'] if c['status']=='failed'];self.assertTrue(any('projection' in s.lower() for s in fail));self.assertTrue(any('matte support' in s for s in fail))
if __name__=='__main__':unittest.main()
