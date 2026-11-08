"""Adverse-case raster/timing/audio tests; no model or network is required."""
import copy, hashlib, json, math, os, tempfile, unittest, wave, zlib
from fractions import Fraction
from pathlib import Path
from unittest.mock import patch
from full_rezz_render.timing import ExposureClock
from full_rezz_render.project import local_file, read_json

ROOT=Path(__file__).resolve().parents[1]

def clock_config(rate=Fraction(24,1),duration=12):
    return {"schema_version":"1.0.0","source_fps":{"numerator":rate.numerator,"denominator":rate.denominator},"duration_seconds":duration,
        "keys":[{"source_frame":0,"pose_id":"a1"},{"source_frame":24,"pose_id":"a2"}],
        "exposures":[{"start_source_frame":0,"end_source_frame":math.ceil(duration*rate),"hold":2}]}


class ExposureTests(unittest.TestCase):
    def test_ones_convert_to_alternating_two_three_output_holds(self):
        c=clock_config();c["exposures"][0]["hold"]=1
        clock=ExposureClock(c)
        groups=[];old=-1
        for i in range(60):
            tick=clock.at(i)["sample_source_frame"]
            if tick!=old:groups.append(1);old=tick
            else:groups[-1]+=1
        self.assertEqual(groups,[3,2]*12)

    def test_twos_hold_for_five_at_sixty(self):
        clock=ExposureClock(clock_config())
        self.assertEqual([clock.at(i)["sample_source_frame"] for i in range(10)],[0]*5+[2]*5)

    def test_threes_preserve_alternating_eight_seven(self):
        c=clock_config();c["exposures"][0]["hold"]=3
        clock=ExposureClock(c)
        self.assertEqual([clock.at(i)["sample_source_frame"] for i in range(15)],[0]*8+[3]*7)

    def test_fractional_rate_does_not_accumulate_float_drift(self):
        clock=ExposureClock(clock_config(Fraction(24000,1001),600))
        for i in [0,1000,9999,35999]:
            expected=(Fraction(i,60)*Fraction(24000,1001)).numerator//(Fraction(i,60)*Fraction(24000,1001)).denominator
            self.assertEqual(clock.at(i)["source_frame"],expected)

    def test_higher_output_rate_preserves_key_seconds(self):
        c=clock_config()
        self.assertEqual(ExposureClock(c,120).output_key(c["keys"][1])["frame"],120)
        self.assertEqual(ExposureClock(c,240).output_key(c["keys"][1])["frame"],240)

    def test_key_does_not_get_delayed_by_a_hold(self):
        c=clock_config();c["keys"][1]["source_frame"]=23;c["exposures"][0]["hold"]=3
        row=ExposureClock(c).at(58)
        self.assertEqual((row["pose_id"],row["sample_source_frame"]),("a2",23))

    def test_source_key_between_output_frames_uses_ceil(self):
        c=clock_config(Fraction(24000,1001));c["keys"][1]["source_frame"]=1
        row=ExposureClock(c).output_key(c["keys"][1])
        self.assertEqual(row["frame"],3)
        self.assertLess(row["time_seconds"]-row["authored_time_seconds"],1/60)

    def test_gap_is_rejected(self):
        c=clock_config();c["exposures"][0]["start_source_frame"]=1
        with self.assertRaises(ValueError):ExposureClock(c)

    def test_overlap_is_rejected(self):
        c=clock_config();c["exposures"].append({"start_source_frame":10,"end_source_frame":400,"hold":2})
        with self.assertRaises(ValueError):ExposureClock(c)

    def test_missing_initial_pose_is_rejected(self):
        c=clock_config();c["keys"][0]["source_frame"]=1
        with self.assertRaises(ValueError):ExposureClock(c)

    def test_unsupported_or_boolean_fps_is_rejected(self):
        for fps in [True,24,59,241,60.0]:
            with self.subTest(fps=fps),self.assertRaises(ValueError):ExposureClock(clock_config(),fps)

    def test_incomplete_end_or_subframe_duration_is_rejected(self):
        c=clock_config();c["exposures"][0]["end_source_frame"]=287
        with self.assertRaises(ValueError):ExposureClock(c)
        c=clock_config();c["duration_seconds"]=12.001
        with self.assertRaises(ValueError):ExposureClock(c)


class InputBoundaryTests(unittest.TestCase):
    def test_path_escape_and_windows_drive_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            for path in ["../a.png","a/../b.png","/tmp/a.png","C:/a.png","a\\b.png","./a.png"]:
                with self.subTest(path=path),self.assertRaises(ValueError):local_file(root,path)

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root);(p/"a").write_bytes(b"data");(p/"b").symlink_to(p/"a")
            with self.assertRaises(ValueError):local_file(p,"b")

    def test_duplicate_and_nonfinite_json_are_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/"input.json"
            for content in ['{"fps":60,"fps":120}','{"x":NaN}','{"x":Infinity}']:
                p.write_text(content)
                with self.subTest(content=content),self.assertRaises(ValueError):read_json(p)


try:
    import numpy as np
    import av
    from PySide6.QtGui import QImage
    from full_rezz_render.rig import CelMesh
    from full_rezz_render.audit import read_rasters, audio_metrics, audit
    from full_rezz_render.scene import image, Scene
    from full_rezz_render.render import render
    RASTER_AVAILABLE=True
except ImportError:
    RASTER_AVAILABLE=False


@unittest.skipUnless(RASTER_AVAILABLE,"Optional Qt/NumPy/PyAV raster dependencies are not installed")
class RasterTests(unittest.TestCase):
    @staticmethod
    def pose():
        return {"hand":[369.,328.],"eyes":[[222.,88.,14.,9.],[255.,88.,14.,9.]],"mouth":[239.,108.,12.,8.]}

    def test_barycentric_identity_preserves_solid_silhouette(self):
        rgba=np.zeros((544,496,4),np.uint8);rgba[20:535,60:420]=[120,90,60,255]
        mesh=CelMesh(rgba,self.pose(),1);mesh.mapping(self.pose()["hand"]);out=mesh.sample(rgba)
        np.testing.assert_array_equal(out[25:530,65:415],rgba[25:530,65:415])
        self.assertGreater(np.count_nonzero(out[:,:,3]),175000)

    def test_triangle_seams_do_not_create_holes(self):
        rgba=np.zeros((544,496,4),np.uint8);rgba[20:535,60:420]=[120,90,60,255]
        mesh=CelMesh(rgba,self.pose(),2);mesh.mapping(self.pose()["hand"]);out=mesh.sample(rgba)
        self.assertTrue(np.all(out[50:1050,140:800,3]==255))

    def test_transparent_rgb_does_not_bleed_into_edges(self):
        rgba=np.zeros((544,496,4),np.uint8);rgba[:,:,:3]=[0,255,255];rgba[30:530,100:250]=[180,0,0,255]
        mesh=CelMesh(rgba,self.pose(),1.5);mesh.mapping(self.pose()["hand"]);out=mesh.sample(rgba)
        edge=out[(out[:,:,3]>0)&(out[:,:,3]<255)]
        self.assertGreater(len(edge),0);self.assertLessEqual(int(edge[:,1:3].max()),1);self.assertGreaterEqual(int(edge[:,0].min()),179)

    def test_extreme_target_is_limited_without_folding(self):
        rgba=np.full((544,496,4),255,np.uint8)
        mesh=CelMesh(rgba,self.pose(),.25);row=mesh.mapping([5000.,-5000.])
        self.assertTrue(row["limited"]);self.assertLessEqual(np.linalg.norm(row["delta"]),45+1e-8);self.assertGreaterEqual(row["minimum_triangle_area_ratio"],.4)

    def test_facial_protection_keeps_eyes_and_mouth_stationary(self):
        from full_rezz_render.rig import arm_weights
        pose=self.pose()
        self.assertTrue(np.all(arm_weights([pose["eyes"][0][:2],pose["eyes"][1][:2],pose["mouth"][:2]],pose)==0))

    def test_raster_reader_rejects_truncation_and_extra_data(self):
        raw=bytes(128*72*3+320*180)
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/"data"
            p.write_bytes(zlib.compress(raw));self.assertEqual(len(list(read_rasters(p,1))),1)
            for content in [zlib.compress(raw)[:-3],zlib.compress(raw+raw),zlib.compress(raw)+b"trailing"]:
                p.write_bytes(content)
                with self.subTest(size=len(content)),self.assertRaises(ValueError):list(read_rasters(p,1))

    def test_audio_metrics_detect_shift_and_clipping(self):
        rng=np.random.default_rng(42);x=np.rint(rng.uniform(-.4,.4,30000)*32768).astype(np.int16)
        y=x.astype(float)/32768
        good=audio_metrics(x,y,0,len(x));self.assertAlmostEqual(good["correlation"],1);self.assertEqual(good["best_alignment_lag_samples"],0)
        shifted=np.r_[np.zeros(120),y][:-120];bad=audio_metrics(x,shifted,0,len(x))
        self.assertLess(bad["correlation"],.1);self.assertEqual(abs(bad["best_alignment_lag_samples"]),120)
        clipped=y.copy();clipped[100]=1.2;self.assertGreater(audio_metrics(x,clipped,0,len(x))["decoded_peak"],1)


@unittest.skipUnless(RASTER_AVAILABLE,"Optional Qt/NumPy/PyAV raster dependencies are not installed")
class OfflineIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from full_rezz_render.scene import initialize_qt
        initialize_qt()
        cls.temp=tempfile.TemporaryDirectory(prefix="full-rezz-raster-tests-");cls.base=Path(cls.temp.name);cls.project=cls.base/"project";cls.project.mkdir()
        assets=cls.project/"assets";(assets/"fonts").mkdir(parents=True)
        import shutil
        fonts=ROOT/"animation/project/assets/fonts"
        if not fonts.exists():fonts=ROOT.parent/"Rebecca_2D_60fps/assets/fonts"
        for name in ["DejaVuSans.ttf","DejaVuSans-Bold.ttf"]:shutil.copy2(fonts/name,assets/"fonts"/name)
        rgba=np.zeros((544,496,4),np.uint8)
        for x0,y0,x1,y1 in [(200,40,278,150),(142,150,343,360),(140,350,204,531),(298,350,350,531),(100,180,157,280),(325,220,394,340),(122,492,180,531),(306,492,345,531)]:rgba[y0:y1,x0:x1]=[60,140,190,255]
        assert image(rgba).save(str(assets/"a1.png"),"PNG");assert image(rgba).save(str(assets/"a1.face.png"),"PNG")
        bg=np.zeros((720,1280,4),np.uint8);bg[:]=[45,60,78,255];bg[:,:,1]+=np.arange(1280,dtype=np.uint8)[None,:]//16
        assert image(bg).save(str(assets/"background.png"),"PNG")
        pose={"id":"a1","base":"assets/a1.png","face":"assets/a1.face.png","registered_contacts":[[150,530],[326,530]],**RasterTests.pose()}
        (cls.project/"pose_model.json").write_text(json.dumps({"poses":[pose]}))
        config=json.loads((ROOT/"animation/project/render_config.json" if (ROOT/"animation/project/render_config.json").exists() else ROOT.parent/"Rebecca_2D_60fps/render_config.json").read_text())
        config.update(duration_seconds=.5,voice_offset_seconds=.1,keys=[{"source_frame":0,"pose_id":"a1","label":"test"}],exposures=[{"start_source_frame":0,"end_source_frame":12,"hold":2}])
        config["presets"]["preview"]={"width":320,"height":180,"supersampling":1,"crf":14};config["camera"]["push_fraction"]=0;config["lighting"]["enabled"]=False
        (cls.project/"render_config.json").write_text(json.dumps(config))
        cls.source=np.rint(.2*np.sin(2*np.pi*440*np.arange(6000)/24000)*32768).astype("<i2")
        with wave.open(str(assets/"statement.original.wav"),"wb") as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(24000);f.writeframes(cls.source.tobytes())
        cls.output=cls.base/"render"
        with patch("socket.getaddrinfo",side_effect=AssertionError("Network forbidden")),patch("socket.create_connection",side_effect=AssertionError("Network forbidden")):
            cls.receipt=render(cls.project,cls.output,"preview",120)

    @classmethod
    def tearDownClass(cls):
        import shutil
        path=cls.receipt.get("raw_reference_path")
        if path:shutil.rmtree(Path(path).parent)
        cls.temp.cleanup()

    def test_actual_fixture_encodes_sixty_frames_at_120_fps(self):
        with av.open(str(self.output/"Rebecca_Full_Voiced_Action.mp4")) as c:
            self.assertEqual(c.streams.video[0].average_rate,Fraction(120,1));self.assertEqual(sum(1 for _ in c.decode(video=0)),60)
        self.assertEqual(self.receipt["fps"],120)

    def test_offline_audit_can_pass_without_external_ffmpeg(self):
        result=audit(self.project,self.output,raw_reference=self.receipt["raw_reference_path"]);report=read_json(self.output/"audit_report.json")
        self.assertEqual(result["failed"],0,msg=report["checks"]);self.assertEqual(result["human_quality_review"],"pending")
        self.assertEqual(report["audit_coverage"],"exhaustive")

    def test_existing_output_is_preserved(self):
        before=(self.output/"Rebecca_Full_Voiced_Action.mp4").read_bytes()
        with self.assertRaises(ValueError):render(self.project,self.output,"preview",120)
        self.assertEqual(before,(self.output/"Rebecca_Full_Voiced_Action.mp4").read_bytes())

    def test_process_audits_and_releases_private_pixel_buffer(self):
        from full_rezz_render.pipeline import process
        result=process(self.project,self.base/"pipeline","preview",120)
        self.assertEqual(result["failed"],0);self.assertTrue(result["temporary_raster_released"])
        self.assertEqual(result["audit_coverage"],"exhaustive")

    def test_cancelled_render_never_publishes_partial_output(self):
        target=self.base/"cancelled"
        def cancel(n,total):raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):render(self.project,target,"preview",120,cancel)
        self.assertFalse(target.exists());self.assertFalse(any(self.base.glob('.full-rezz-render-*')))

    def test_missing_encoded_frame_is_rejected_even_when_hash_is_updated(self):
        import shutil
        target=self.base/"drop-frame";shutil.copytree(self.output,target)
        path=target/"Rebecca_Full_Voiced_Action.mp4"
        # Re-encode 59 frames with no audio to exercise media validation beyond hashes.
        with av.open(str(self.output/path.name)) as src,av.open(str(path),"w",format="mp4") as dest:
            stream=dest.add_stream("libx264",rate=120);stream.width=320;stream.height=180;stream.pix_fmt="yuv420p"
            for i,frame in enumerate(src.decode(video=0)):
                if i==59:break
                for packet in stream.encode(frame):dest.mux(packet)
            for packet in stream.encode():dest.mux(packet)
        receipt=read_json(target/"render_receipt.json");receipt["output_sha256"][path.name]=hashlib.sha256(path.read_bytes()).hexdigest();(target/"render_receipt.json").write_text(json.dumps(receipt))
        result=audit(self.project,target);self.assertGreater(result["failed"],0)

    def test_modified_exposure_evidence_is_rejected(self):
        import shutil
        target=self.base/"wrong-exposure";shutil.copytree(self.output,target)
        receipt=read_json(target/"render_receipt.json");receipt["frame_evidence"][8]["sample_source_frame"]+=1;(target/"render_receipt.json").write_text(json.dumps(receipt))
        result=audit(self.project,target);self.assertGreater(result["failed"],0)

    def test_rim_lighting_does_not_repaint_protected_face(self):
        from full_rezz_render.project import Project
        scene=Scene(Project(self.project,"preview",120));scene.project.config["lighting"]["enabled"]=True
        pose=scene.project.poses["a1"];rgba=np.full((544,496,4),255,np.uint8)
        # A transparent stripe through the facial region would create light edges
        # inside the face if protection were lost.
        rgba[:,232:234,3]=0;lit=scene.light_texture(rgba,pose)
        np.testing.assert_array_equal(lit[scene.protected["a1"]],rgba[scene.protected["a1"]])

if __name__=="__main__":unittest.main()
