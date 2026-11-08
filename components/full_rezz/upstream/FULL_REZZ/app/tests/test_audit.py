"""Regressions for failures reproduced during the v1.0 audit."""
import hashlib
import csv
import json
import socket
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
from scipy.io import wavfile

from voice_studio import audio, research
from voice_studio.engine import Studio, write_json
from voice_studio.sdk import VoiceLibrary
from voice_studio.project_lock import ProjectLock


class ProjectAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.studio = Studio(self.root / "project")
        self.path = self.root / "voice.wav"
        self.sr = 24000
        x = (0.2 * np.sin(2 * np.pi * 180 * np.arange(self.sr * 4) / self.sr)).astype(np.float32)
        wavfile.write(self.path, self.sr, x)
        self.record = self.studio.import_audio(self.path)
        self.profile = self.studio.new_profile("Aster")

    def tearDown(self):
        self.temp.cleanup()

    def assigned(self, rows=None):
        rows = rows or [{"start": 0, "end": 3, "speaker": "A", "purity": "reviewed_single_voice"}]
        record = self.studio.save_segments(self.record["id"], rows)
        self.studio.bind(record["id"], "A", self.profile["id"])
        return self.studio.record(record["id"])

    def test_reanalysis_requires_new_identity_binding_and_preserves_history(self):
        record = self.studio.analyze(self.record["id"])
        before = self.studio.bind(record["id"], "VOICE_01", self.profile["id"])
        after = self.studio.analyze(record["id"])
        self.assertEqual({}, after["bindings"])
        history = list((self.studio.record_path(record["id"]) / "history").glob("*.json"))
        self.assertTrue(history)
        saved = json.loads((self.studio.record_path(record["id"]) / "history" / f"revision_{before['revision']:08d}.json").read_text())
        self.assertEqual(before["bindings"], saved["bindings"])
        self.assertEqual(before["segments"], saved["segments"])

    def test_removed_speaker_binding_is_pruned(self):
        record = self.assigned()
        self.assertEqual({}, self.studio.save_segments(record["id"], [
            {"start": 0, "end": 3, "speaker": "B"}])["bindings"])

    def test_stale_region_editor_does_not_overwrite_newer_revision(self):
        record = self.assigned()
        self.studio.bind(record["id"], "A", None)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.studio.save_segments(record["id"], record["segments"], expected_revision=record["revision"])

    def test_stale_character_editor_does_not_overwrite_newer_canon(self):
        original = self.studio.profile(self.profile["id"])
        changed = research.character_defaults()
        changed["biography"] = "New canon"
        self.studio.update_character(original["id"], changed)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.studio.update_character(original["id"], original["character"], expected_revision=original.get("revision", 0))
        self.assertEqual("New canon", self.studio.profile(original["id"])["character"]["biography"])

    def test_overlap_stays_ambiguous_with_unequal_coverage_and_exclusive_prediction(self):
        record = self.assigned([
            {"start": 0, "end": 3, "speaker": "A", "purity": "model_nonoverlap"},
            {"start": 1, "end": 1.6, "speaker": "B", "purity": "model_nonoverlap"}])
        record["exclusive_segments"] = [{"start": 0, "end": 3, "speaker": "A"}]
        record["transcription"] = {"segments": [{"start": 1, "end": 2, "text": "Hello", "words": [
            {"start": 1, "end": 2, "word": " Hello", "probability": 0.9}]}]}
        word = self.studio.transcript_rows(record)[0]
        self.assertIsNone(word["speaker"])
        self.assertIsNone(word["profile_id"])
        self.assertEqual("ambiguous", word["assignment"])
        self.assertEqual(["A", "B"], word["overlap_speakers"])

    def test_duplicate_timeline_annotations_do_not_inflate_reference_duration(self):
        self.assigned([
            {"start": 0, "end": 3, "speaker": "A", "purity": "reviewed_single_voice"},
            {"start": 1, "end": 2, "speaker": "A", "purity": "reviewed_single_voice"}])
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        self.assertEqual(3, library.profile(self.profile["id"])["reference_seconds"])

    def test_clean_asr_text_and_logs_are_linked_to_reference_clips(self):
        record = self.assigned()
        record["transcription"] = {"model": "fixture", "segments": [{"start": 0.5, "end": 1.5,
            "text": "Hello there", "words": [
                {"start": 0.5, "end": 1, "word": " Hello", "probability": 0.9},
                {"start": 1, "end": 1.5, "word": " there", "probability": 0.9}]}]}
        self.studio._commit(record)
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        ref = library.reference(self.profile["id"])
        self.assertEqual("Hello there", ref["text"])
        self.assertEqual("asr_word_timestamps", ref["text_alignment"])
        logs_path = library.root / library.profile(self.profile["id"])["character_context"]["voice_logs_path"]
        logs = [json.loads(line) for line in logs_path.read_text().splitlines()]
        self.assertTrue(all(log["reference_ids"] for log in logs if log["text_origin"] == "transcription"))

    def test_measurements_describe_actual_processed_and_encoded_reference(self):
        self.assigned()
        self.studio.save_audio_settings(self.record["id"], {"enabled": True, "peak_dbfs": -6})
        ref = VoiceLibrary(self.studio.export(encoding="PCM16").with_suffix("")).reference(self.profile["id"])
        sr, delivered = audio.read_audio(Path(ref["absolute_path"]))
        self.assertEqual(audio.acoustics(delivered, sr), ref["measurements"])
        self.assertAlmostEqual(-6, ref["measurements"]["peak_dbfs"], delta=.01)
        self.assertEqual(0, ref["measurements"]["clipping_fraction"])

    def test_stale_cleanup_editor_cannot_overwrite_newer_recording_settings(self):
        original = self.studio.record(self.record["id"])
        self.studio.save_audio_settings(original["id"], {"enabled": True, "peak_dbfs": -6}, original["revision"])
        with self.assertRaisesRegex(ValueError, "changed"):
            self.studio.save_audio_settings(original["id"], {"enabled": False}, original["revision"])
        self.assertTrue(self.studio.record(original["id"])["audio_processing"]["enabled"])

    def test_reference_integrity_is_checked_before_renderer_use(self):
        self.assigned()
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        ref = library.reference(self.profile["id"])
        with Path(ref["absolute_path"]).open("ab") as stream:
            stream.write(b"modified")
        with self.assertRaisesRegex(ValueError, "integrity"):
            library.reference(self.profile["id"])

    def test_sdk_rejects_invalid_style_boolean_prosody_and_invalid_xml_text(self):
        self.assigned()
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        for kwargs in [{"style": None}, {"rate": True}, {"pitch_semitones": True}, {"volume_db": True}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                library.expression_request(self.profile["id"], "Hello", **kwargs)
        with self.assertRaises(ValueError):
            library.expression_request(self.profile["id"], "Hello\x00")

    def test_csv_exports_preserve_formulas_as_literal_text(self):
        text = '=HYPERLINK("https://example.org","not executable")'
        self.assigned([{"start": 0, "end": 3, "speaker": "A", "purity": "reviewed_single_voice", "text": text}])
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        with (library.root / "segments.csv").open(encoding="utf-8-sig") as stream:
            row = next(csv.DictReader(stream))
        self.assertEqual("'" + text, row["text"])
        self.assertEqual(text, library.reference(self.profile["id"])["text"])

    def test_unicode_source_search_offsets_refer_to_original_text(self):
        text = "Straße. Navigator Aster."
        source = self.studio.import_source(self.profile["id"], text.encode(), "canon.txt")
        match = self.studio.source_text(self.profile["id"], source["id"], "Navigator")["matches"][0]
        self.assertEqual(text.index("Navigator"), match["character_offset"])

    def test_project_lock_prevents_second_writer_and_releases_cleanly(self):
        with ProjectLock(self.studio.root):
            with self.assertRaisesRegex(ValueError, "already open"):
                ProjectLock(self.studio.root)
        with ProjectLock(self.studio.root):
            pass

    def test_regions_cannot_collapse_after_timestamp_rounding(self):
        with self.assertRaisesRegex(ValueError, "precision"):
            self.studio.save_segments(self.record["id"], [{"speaker": "A", "start": 0.0000001, "end": 0.0000002}])

    def test_export_normalizes_valid_legacy_characters_without_changing_stored_canon(self):
        self.assigned()
        profiles = self.studio.profiles()
        profiles[0]["character"] = {"biography": "Old authored canon", "persona": {"speech_style": "precise"}, "extension_engram": {"memory": "keep"}}
        write_json(self.studio.profiles_file, profiles)
        library = VoiceLibrary(self.studio.export().with_suffix(""))
        character = library.profile(self.profile["id"])["character"]
        self.assertEqual("Old authored canon", character["biography"])
        self.assertEqual([], character["persona"]["traits"])
        self.assertEqual({"memory": "keep"}, character["extension_engram"])
        self.assertNotIn("kind", self.studio.profile(self.profile["id"])["character"])


class CharacterAuditTests(unittest.TestCase):
    def test_known_persona_fields_and_prompt_templates_have_valid_types(self):
        for section, field, value in [("persona", "traits", "curious"), ("persona", "traits", [42]),
                                      ("persona", "speech_style", []), ("prompts", "system", ["instruction"])]:
            c = research.character_defaults()
            c[section][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                research.validate_character(c, set())

    def test_partial_persona_and_prompts_get_nested_defaults(self):
        c = research.validate_character({"persona": {"speech_style": "precise"}, "prompts": {"system": "Hello"}}, set())
        self.assertEqual([], c["persona"]["traits"])
        self.assertEqual("", c["prompts"]["dialogue"])

    def test_embedded_field_source_ids_must_be_attached(self):
        for section in ["demographics", "statistics"]:
            with self.subTest(section=section), self.assertRaisesRegex(ValueError, "attached"):
                research.validate_character({section: {"age": {"value": 42, "source_id": "src_0000000000000000"}}}, set())

    def test_malformed_source_fields_are_ignored_without_poisoning_a_draft(self):
        sid = "src_0000000000000001"
        profile = {"character": research.character_defaults(), "sources": [
            {"id": sid, "kind": "imported_document", "original_path": "original.json"}]}
        result = research.draft_from_sources(profile, {sid: json.dumps({
            "persona": {"traits": None}, "prompts": {"system": ["not text"]}, "demographics": {"age": 42}})}, [])
        self.assertEqual([], result["character"]["persona"]["traits"])
        self.assertEqual("", result["character"]["prompts"]["system"])
        self.assertEqual(42, result["character"]["demographics"]["age"])
        self.assertEqual(2, len(result["ignored_fields"]))


class AudioAuditTests(unittest.TestCase):
    def test_pitch_search_handles_both_advertised_endpoints(self):
        sr = 24000
        for frequency in [65, 70, 180, 270, 480, 500]:
            x = (0.2 * np.sin(2 * np.pi * frequency * np.arange(sr) / sr)).astype(np.float32)
            with self.subTest(frequency=frequency):
                measured = audio.acoustics(x, sr)["pitch_hz"]["median"]
                self.assertIsNotNone(measured)
                self.assertAlmostEqual(frequency, measured, delta=1)

    def test_waveform_shows_activity_when_stereo_phase_cancels_the_mix(self):
        x = np.ones(1000, dtype=np.float32) * 0.2
        self.assertGreater(max(audio.waveform(np.stack([x, -x], axis=1))), 0.19)

    def test_wav_header_limits_are_checked_before_sample_allocation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "large.wav"
            wavfile.write(path, 8000, np.zeros(8000, dtype=np.float32))
            with patch("voice_studio.audio.MAX_DECODED_BYTES", 100), patch("voice_studio.audio.wavfile.read", side_effect=AssertionError("Allocated before validation")):
                with self.assertRaisesRegex(ValueError, "limit|MiB"):
                    audio.read_audio(path)


class ResearchSecurityAuditTests(unittest.TestCase):
    def test_actual_connection_rejects_rebound_private_address(self):
        with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 80))]), patch("socket.socket") as sock:
            with self.assertRaises(ValueError):
                research.public_connection(("example.org", 80), timeout=1)
            sock.assert_not_called()

    def test_connection_uses_validated_numeric_address_without_second_resolution(self):
        with patch("socket.getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 80))]) as dns, patch("socket.socket") as sock:
            result = research.public_connection(("example.org", 80), timeout=1)
            self.assertEqual(sock.return_value, result)
            self.assertEqual(1, dns.call_count)
            sock.return_value.connect.assert_called_once_with(("93.184.216.34", 80))

    def test_malformed_docx_returns_actionable_validation_error(self):
        with self.assertRaisesRegex(ValueError, "DOCX"):
            research.extract_document(b"not a zip", "reference.docx")


if __name__ == "__main__":
    unittest.main()
