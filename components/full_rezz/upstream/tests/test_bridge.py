"""Boundary tests use the supplied character pack and clearly authored test audio.

Temporary sine-tone WAVs are transport fixtures, not synthesized character speech.
"""
from pathlib import Path
import copy, hashlib, json, math, shutil, struct, subprocess, sys, tempfile, unittest, wave

from full_rezz_bridge import ContractError, ReferencePack, action_plan, inspect_render, speech_body
from full_rezz_bridge.contracts import checked_file, parse_json, read_json

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "examples/rebecca_reference_pack"
PID = "voice_57373fea79f3473e"

class PackTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name) / "pack"; shutil.copytree(PACK, self.root)
        self.m = json.loads((self.root / "manifest.json").read_text()); self.p = self.m["profiles"][0]
    def tearDown(self): self.temp.cleanup()
    def write(self): (self.root / "manifest.json").write_text(json.dumps(self.m))
    def test_actual_pack_preserves_canon_and_attribution(self):
        e = ReferencePack(self.root).to_engram(PID)
        self.assertEqual(e["authored_character"], self.p["character"])
        self.assertEqual(e["authored_character"]["demographics"]["canonical_status"], "deceased")
        self.assertEqual(len(e["source_evidence"]), 10)
        self.assertFalse(e["trust"]["prompts_executed"])
        self.assertFalse(e["trust"]["reasoning_engine_executed"])
    def test_unknown_fields_survive_and_return_is_independent(self):
        self.p["host_extension"] = {"mood_history": ["authored"], "nested": {"future": True}}; self.write()
        pack = ReferencePack(self.root); e = pack.to_engram(PID)
        self.assertEqual(e["profile_snapshot"]["host_extension"], self.p["host_extension"])
        e["profile_snapshot"]["character"]["biography"] = "changed"
        self.assertNotEqual(pack.profile(PID)["character"]["biography"], "changed")
    def test_corrupt_reference_rejected(self):
        audio = self.root / self.p["references"][0]["path"]; audio.write_bytes(audio.read_bytes() + b"changed")
        with self.assertRaisesRegex(ContractError, "SHA256"): ReferencePack(self.root)
    def test_missing_audio_hash_rejected(self):
        self.p["references"][0].pop("sha256"); self.write()
        with self.assertRaisesRegex(ContractError, "declared checksum"): ReferencePack(self.root)
    def test_corrupt_source_rejected(self):
        source = self.root / self.p["sources"][0]["text_path"]; source.write_text("Changed evidence")
        with self.assertRaisesRegex(ContractError, "SHA256"): ReferencePack(self.root)
    def test_unresolved_attribution_rejected(self):
        self.p["character"]["field_sources"]["biography"] = ["src_0000000000000000"]; self.write()
        with self.assertRaisesRegex(ContractError, "attribution"): ReferencePack(self.root)
    def test_malformed_attribution_is_contract_error(self):
        self.p["character"]["field_sources"]["biography"] = [{}]; self.write()
        with self.assertRaises(ContractError): ReferencePack(self.root)
    def test_duplicate_profile_rejected(self):
        self.m["profiles"].append(copy.deepcopy(self.p)); self.write()
        with self.assertRaisesRegex(ContractError, "Duplicate profile"): ReferencePack(self.root)
    def test_character_copy_disagreement_rejected(self):
        (self.root / self.p["character_context"]["path"]).write_text("{}")
        with self.assertRaisesRegex(ContractError, "disagree"): ReferencePack(self.root)
    def test_future_version_rejected(self):
        self.m["schema_version"] = "99.0.0"; self.write()
        with self.assertRaisesRegex(ContractError, "version"): ReferencePack(self.root)
    def test_unknown_recording_rejected(self):
        self.p["references"][0]["recording_id"] = "rec_0000000000000000"; self.write()
        with self.assertRaisesRegex(ContractError, "unknown recording"): ReferencePack(self.root)
    def test_declared_voice_does_not_become_listening_reviewed(self):
        pack = ReferencePack(self.root)
        ref = pack.select_reference(PID, "concern")
        self.assertEqual(ref["review_status"], "user_declared_single_voice")
        with self.assertRaisesRegex(ContractError, "review policy"): pack.select_reference(PID, require_reviewed=True)
    def test_rejected_reference_not_selected(self):
        self.p["references"][0]["quality"]["status"] = "reject"; self.write()
        with self.assertRaisesRegex(ContractError, "No eligible"): ReferencePack(self.root).select_reference(PID)
    def test_after_load_asset_change_rejected(self):
        pack = ReferencePack(self.root); ref = self.root / self.p["references"][0]["path"]; ref.write_bytes(b"changed")
        with self.assertRaises(ContractError): pack.to_engram(PID)
    def test_request_is_descriptor_not_generated_speech(self):
        request = ReferencePack(self.root).request(PID, "The offline archive is ready.", style="concern", seed=42)
        self.assertFalse(request["generates_audio"]); self.assertEqual(request["body"]["seed"], 42)
    def test_sample_rate_and_quality_types_rejected(self):
        for field, value in (("sample_rate_hz", 44100.5), ("quality", []), ("measurements", [])):
            with self.subTest(field=field):
                original = copy.deepcopy(self.p["references"][0]); self.p["references"][0][field] = value; self.write()
                with self.assertRaises(ContractError): ReferencePack(self.root)
                self.p["references"][0] = original

class InputTests(unittest.TestCase):
    def test_paths_reject_windows_and_traversal_forms(self):
        with tempfile.TemporaryDirectory() as root:
            for value in ("../escape", "/absolute", "C:/file", "folder\\file", "CON.txt", "x/../y", "x//y", "x/./y", "x.", "x ", "x?.wav", "x|y", "x\nfile"):
                with self.subTest(value=value), self.assertRaises(ContractError): checked_file(root, value)
    def test_symlink_inside_root_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / "real").write_text("test")
            try: (root / "link").symlink_to(root / "real")
            except OSError: self.skipTest("Symlink privilege unavailable")
            with self.assertRaisesRegex(ContractError, "Symbolic"): checked_file(root, "link")
    def test_duplicate_and_nonfinite_json_rejected(self):
        for value in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}', '{"x":1e999}'):
            with self.subTest(value=value), self.assertRaises(ContractError): parse_json(value)
    def test_speech_limits_distinguish_request_from_render(self):
        self.assertEqual(len(speech_body(PID, "a" * 500)["text"]), 500)
        for text in ("", " ", "a" * 501, "x\x00y"):
            with self.subTest(text=text[:12]), self.assertRaises(ContractError): speech_body(PID, text)
    def test_parameter_limits_reject_bool_nan_and_fractional_steps(self):
        for options in ({"rate": True}, {"rate": float("nan")}, {"rate": .49}, {"pitch": 13}, {"volume": 7}, {"steps": 16.0}, {"seed": True}, {"seed": -1}, {"scene_notes": "x" * 10001}):
            with self.subTest(options=list(options)), self.assertRaises(ContractError): speech_body(PID, "Hello.", **options)

class RenderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.root = Path(self.temp.name)
        # Transport-only test fixture: a tone, not a cloned or generated character voice.
        with wave.open(str(self.root / "speech.wav"), "wb") as w:
            w.setparams((1, 2, 24000, 0, "NONE", "not compressed")); w.writeframes(b"".join(struct.pack("<h", round(1000 * math.sin(i / 20))) for i in range(12000)))
        shutil.copy2(self.root / "speech.wav", self.root / "reference.wav")
        sha = hashlib.sha256((self.root / "speech.wav").read_bytes()).hexdigest()
        self.receipt = {"schema_version": "2.0.0", "kind": "local_voice_render", "id": "render_0000000000000001", "profile_id": PID,
            "sample_rate_hz": 24000, "duration_seconds": .5, "audio_sha256": sha, "steps": 32, "seed": 42, "reference_words": "Fixture.", "scene_notes": "Transport test only.",
            "request": {"profile_id": PID, "text": "Fixture.", "requested_style": "neutral", "reference": {"sha256": sha},
                        "prosody": {"rate_multiplier": 1, "pitch_semitones": 0, "volume_db": 0}},
            "review_status": "needs_revision", "review_history": [{"status": "needs_revision", "notes": "No listening approval."}], "fixture_not_neural_inference": True}
        self.write()
    def tearDown(self): self.temp.cleanup()
    def write(self): (self.root / "receipt.json").write_text(json.dumps(self.receipt))
    def test_hashes_and_review_preserved(self):
        r = inspect_render(self.root, PID); self.assertTrue(r["integrity_checked"])
        self.assertEqual(r["review_status"], "needs_revision"); self.assertFalse(r["human_listening_performed_by_adapter"])
    def test_changed_speech_or_reference_rejected(self):
        for name in ("speech.wav", "reference.wav"):
            original = (self.root / name).read_bytes(); (self.root / name).write_bytes(b"changed")
            with self.subTest(name=name), self.assertRaisesRegex(ContractError, "SHA256"): inspect_render(self.root)
            (self.root / name).write_bytes(original)
    def test_wrong_profile_rejected(self):
        with self.assertRaisesRegex(ContractError, "different profile"): inspect_render(self.root, "voice_0000000000000000")
    def test_inconsistent_review_rejected(self):
        self.receipt["review_status"] = "approved"; self.write()
        with self.assertRaisesRegex(ContractError, "history"): inspect_render(self.root)
    def test_unknown_receipt_version_rejected(self):
        self.receipt["schema_version"] = "3.0.0"; self.write()
        with self.assertRaises(ContractError): inspect_render(self.root)

class ActionTests(unittest.TestCase):
    def setUp(self): self.d = read_json(ROOT / "examples/rebecca_action.json")
    def test_actual_authored_60fps_plan(self):
        plan = action_plan(ROOT, self.d, PID)
        self.assertEqual(plan["voice_start_frame"], 75); self.assertEqual(plan["distinct_scheduled_poses"], 23); self.assertFalse(plan["generates_animation"])
    def test_no_24fps_or_inconsistent_count(self):
        for field, value in (("fps", 24), ("fps", True), ("frame_count", 719), ("duration_seconds", 11)):
            d = copy.deepcopy(self.d); d[field] = value
            with self.subTest(field=field), self.assertRaises(ContractError): action_plan(ROOT, d)
    def test_duplicate_or_unordered_events_rejected(self):
        self.d["events"][1]["frame"] = 0
        with self.assertRaisesRegex(ContractError, "ordered"): action_plan(ROOT, self.d)
    def test_speech_overrun_rejected(self):
        self.d["voice_offset_seconds"] = 11
        with self.assertRaisesRegex(ContractError, "overrun"): action_plan(ROOT, self.d)
    def test_off_grid_voice_onset_rejected(self):
        self.d["voice_offset_seconds"] = 1.251
        with self.assertRaisesRegex(ContractError, "frame grid"): action_plan(ROOT, self.d)
    def test_automatic_animation_claim_rejected(self):
        self.d["automatic_reanimation"] = True
        with self.assertRaisesRegex(ContractError, "not implemented"): action_plan(ROOT, self.d)
    def test_wrong_character_rejected(self):
        with self.assertRaisesRegex(ContractError, "different profile"): action_plan(ROOT, self.d, "voice_0000000000000000")

class CliTests(unittest.TestCase):
    def test_worker_initialization_failure_releases_project_and_keeps_network_blocked(self):
        script = '''
import json,sys,socket
sys.path.insert(0,'.')
from full_rezz_bridge.local import LocalRuntime,RuntimeUnavailable
try: LocalRuntime(sys.argv[1],sys.argv[2])
except RuntimeUnavailable: pass
else: raise AssertionError('Isolated Python unexpectedly has neural dependencies')
from voice_studio import offline
from voice_studio.project_lock import ProjectLock
with ProjectLock(sys.argv[2]): pass
try: socket.getaddrinfo('example.com',443)
except OSError: blocked=True
else: blocked=False
print(json.dumps({'offline':offline.enabled(),'external_dns_blocked':blocked,'project_lock_released':True}))
'''
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run([sys.executable, "-I", "-S", "-c", script, str(ROOT / "FULL_REZZ/app"), temp], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {"offline": True, "external_dns_blocked": True, "project_lock_released": True})
    def test_demo_runs_without_neural_runtime(self):
        result = subprocess.run([sys.executable, "-I", "-S", "-c", "import sys;sys.path.insert(0,'.');import main;main.main()"], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr); self.assertFalse(json.loads(result.stdout)["inference_performed_on_this_run"])
    def test_cli_json_and_invalid_exit_status(self):
        success = subprocess.run([sys.executable, "-m", "full_rezz_bridge", "inspect-pack", str(PACK)], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(success.returncode, 0, success.stderr); self.assertEqual(json.loads(success.stdout)["profile_id"], PID)
        fail = subprocess.run([sys.executable, "-m", "full_rezz_bridge", "request", str(PACK), PID, ""], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(fail.returncode, 2); self.assertEqual(json.loads(fail.stderr)["kind"], "full_rezz_bridge_error")

if __name__ == "__main__": unittest.main()
