"""Functional tests of audio extraction, provenance, and portable exports."""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import numpy as np
from scipy.io import wavfile

from voice_studio import audio, research
from voice_studio.engine import Studio, timestamp
from voice_studio.sdk import VoiceLibrary


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.studio = Studio(self.root / "workspace")
        self.sr = 24000
        t = np.arange(self.sr * 6) / self.sr
        self.samples = np.stack([0.15 * np.sin(2 * np.pi * 180 * t),
                                 0.12 * np.sin(2 * np.pi * 270 * t)], axis=1).astype(np.float32)
        self.input = self.root / "native.wav"
        audio.write_audio(self.input, self.sr, self.samples)
        self.record = self.studio.import_audio(self.input)
        self.profile = self.studio.new_profile("Aster / Navigator", "Original character", "en")

    def tearDown(self):
        self.temp.cleanup()

    def regions(self, rows=None):
        rows = rows or [{"start": 0, "end": 3, "speaker": "A", "channel": 0,
                         "purity": "reviewed_single_voice", "text": "Course is clear.", "style": "gentle"}]
        record = self.studio.save_segments(self.record["id"], rows)
        self.studio.bind(record["id"], "A", self.profile["id"])
        return self.studio.record(record["id"])

    def test_native_rate_original_and_hash_retained(self):
        record = self.record
        directory = self.studio.record_path(record["id"])
        self.assertEqual(self.sr, record["sample_rate"])
        self.assertEqual(2, record["channels"])
        self.assertEqual(self.input.read_bytes(), (directory / record["original_file"]).read_bytes())
        self.assertEqual(hashlib.sha256(self.input.read_bytes()).hexdigest(), record["original_sha256"])

    def test_unsigned_pcm_silence(self):
        path = self.root / "8bit.wav"
        wavfile.write(path, 8000, np.full(8000, 128, np.uint8))
        _, data = audio.read_audio(path)
        self.assertTrue(np.all(data == 0))
        self.assertEqual([], audio.activity_regions(data, 8000))

    def test_pitch_measurements_on_known_signals(self):
        for channel, expected in [(0, 180), (1, 270)]:
            result = audio.acoustics(self.samples[:, channel], self.sr)
            self.assertAlmostEqual(expected, result["pitch_hz"]["median"], delta=1)
        noise = np.random.default_rng(41).normal(0, 0.05, self.sr).astype(np.float32)
        self.assertLess(audio.acoustics(noise, self.sr)["estimated_voiced_frame_fraction"], 0.1)

    def test_channel_export_contains_only_target_channel(self):
        record = self.regions()
        archive = self.studio.export()
        library = VoiceLibrary(archive.with_suffix(""))
        profile = library.profile(self.profile["id"])
        self.assertEqual(1, profile["reference_count"])
        ref = library.reference(profile["id"], "gentle")
        sr, extracted = audio.read_audio(Path(ref["absolute_path"]))
        self.assertEqual(self.sr, sr)
        self.assertEqual(1, extracted.shape[1])
        self.assertAlmostEqual(180, ref["measurements"]["pitch_hz"]["median"], delta=1)
        self.assertEqual(0, ref["channel"])
        self.assertEqual("Course is clear.", ref["text"])

    def test_detected_overlap_is_removed_from_both_reference_regions(self):
        record = self.regions([
            {"start": 0, "end": 4, "speaker": "A", "channel": None, "purity": "model_nonoverlap"},
            {"start": 2, "end": 5, "speaker": "B", "channel": None, "purity": "model_nonoverlap"},
        ])
        self.assertEqual([(0, 2)], self.studio.clean_regions(record, record["segments"][0]))
        self.assertEqual([(4, 5)], self.studio.clean_regions(record, record["segments"][1]))
        archive = self.studio.export()
        ref = VoiceLibrary(archive.with_suffix("")).reference(self.profile["id"])
        self.assertEqual(2, ref["source_end_seconds"])

    def test_independent_channels_are_not_excluded_for_overlap(self):
        record = self.regions([
            {"start": 0, "end": 4, "speaker": "A", "channel": 0, "purity": "reviewed_single_voice"},
            {"start": 2, "end": 5, "speaker": "B", "channel": 1, "purity": "reviewed_single_voice"},
        ])
        self.assertEqual([(0, 4)], self.studio.clean_regions(record, record["segments"][0]))

    def test_unreviewed_channel_has_no_clean_reference(self):
        self.regions([{"start": 0, "end": 3, "speaker": "A", "channel": 0, "purity": "unreviewed"}])
        archive = self.studio.export()
        library = VoiceLibrary(archive.with_suffix(""))
        self.assertEqual("no_clean_references", library.profile(self.profile["id"])["status"])
        with self.assertRaisesRegex(ValueError, "no eligible"):
            library.reference(self.profile["id"])

    def test_invalid_times_channels_and_labels_rejected(self):
        for item in [dict(start=-1, end=1), dict(start=True, end=2), dict(start=1, end=1), dict(start=0, end=7),
                     dict(start=0, end=float("nan")), dict(start=0, end=1, channel=3),
                     dict(start=0, end=1, channel=True), dict(start=0, end=1, speaker="")]:
            with self.assertRaises(ValueError):
                self.studio.save_segments(self.record["id"], [{"speaker": "A", **item}])

    def test_changed_speaker_regions_invalidate_embeddings(self):
        record = self.regions()
        record["embeddings"] = {"A": [1, 2]}
        record["embedding_model"] = "test"
        self.studio._commit(record)
        rows = record["segments"]
        rows[0]["end"] = 2
        result = self.studio.save_segments(record["id"], rows)
        self.assertEqual({}, result["embeddings"])

    def test_character_sources_prompts_and_logs_export_together(self):
        record = self.regions()
        original = "Aster's original canon.\nAge: 42\nStatistics edition: v2\n世界".encode("utf-8")
        source = self.studio.import_source(self.profile["id"], original, "canon.md")
        character = research.character_defaults()
        character.update({"kind": "original", "biography": "Aster is a navigator.",
                          "demographics": {"age": {"value": 42, "source_id": source["id"]}, "pronouns": "she/her"},
                          "statistics": {"navigation": {"value": 9, "system": "Example v2", "unit": "points"}},
                          "field_sources": {"biography": [source["id"]]}, "extension_engram": {"memory": "preserve"}})
        character["prompts"]["system"] = "Play Aster with precise, gentle dialogue."
        self.studio.update_character(self.profile["id"], character)
        archive = self.studio.export()
        directory = archive.with_suffix("")
        manifest = VoiceLibrary(directory).manifest
        profile = manifest["profiles"][0]
        self.assertEqual(character, profile["character"])
        self.assertEqual(1, profile["character_context"]["completeness"]["source_count"])
        self.assertEqual(original, (directory / source["original_path"]).read_bytes())
        self.assertIn("世界", (directory / source["text_path"]).read_text())
        prompt = (directory / profile["character_context"]["prompt_path"]).read_text()
        self.assertIn("precise, gentle", prompt)
        logs = [json.loads(line) for line in (directory / profile["character_context"]["voice_logs_path"]).read_text().splitlines()]
        self.assertEqual("Course is clear.", logs[0]["text"])
        self.assertTrue(logs[0]["reference_ids"])
        with zipfile.ZipFile(archive) as bundle:
            self.assertIn(source["original_path"], bundle.namelist())

    def test_invalid_character_citations_rejected(self):
        character = research.character_defaults()
        character["field_sources"] = {"biography": ["invented-source"]}
        with self.assertRaisesRegex(ValueError, "attached source"):
            self.studio.update_character(self.profile["id"], character)

    def test_source_search_and_unknown_source(self):
        source = self.studio.import_source(self.profile["id"], b"Navigator Aster. Navigators cross the void.", "bio.txt")
        result = self.studio.source_text(self.profile["id"], source["id"], "navigator")
        self.assertEqual(2, len(result["matches"]))
        with self.assertRaises(ValueError):
            self.studio.source_text(self.profile["id"], "src_other")

    def test_research_draft_preserves_canon_and_extracts_explicit_persona(self):
        profile = self.studio.profile(self.profile["id"])
        profile["character"]["biography"] = "Authored canon wins."
        self.studio.update_character(profile["id"], profile["character"])
        source = self.studio.import_source(profile["id"], json.dumps({"character": {
            "biography": "Different source bio.", "demographics": {"age": 42},
            "persona": {"speech_style": "precise", "traits": ["curious"]},
            "statistics": {"navigation": {"value": 9, "system": "Example v2"}}}}).encode(), "character.json")
        result = self.studio.draft_character(profile["id"])
        character = result["character"]
        self.assertEqual("Authored canon wins.", character["biography"])
        self.assertEqual(42, character["demographics"]["age"])
        self.assertEqual("precise", character["persona"]["speech_style"])
        self.assertEqual([source["id"]], character["field_sources"]["demographics.age"])
        self.assertEqual("biography", result["conflicts"][0]["field"])
        self.assertNotIn("age", self.studio.profile(profile["id"])["character"]["demographics"])

    def test_docx_import_keeps_table_text_and_original(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as bundle:
            bundle.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Biography</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Strength 12</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>')
        result = research.extract_document(buffer.getvalue(), "character.docx")
        self.assertIn("Biography", result["text"])
        self.assertIn("Strength 12", result["text"])
        self.assertTrue(result["warnings"])

    def test_scanned_pdf_extraction_is_flagged(self):
        try:
            from pypdf import PdfWriter
        except ImportError:
            self.skipTest("pypdf unavailable")
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        buffer = io.BytesIO()
        writer.write(buffer)
        result = research.extract_document(buffer.getvalue(), "scan.pdf")
        self.assertIn("OCR", result["warnings"][0])

    def test_expression_includes_character_and_escaped_ssml(self):
        self.regions()
        character = research.character_defaults()
        character["biography"] = "Aster is a navigator."
        self.studio.update_character(self.profile["id"], character)
        archive = self.studio.export()
        request = VoiceLibrary(archive.with_suffix("")).expression_request(self.profile["id"], "A < B & C", "gentle", 1.1, 2)
        self.assertIn("A &lt; B &amp; C", request["ssml"])
        self.assertEqual(character, request["character"])
        self.assertTrue(request["style_match"])
        self.assertIsNone(request["generated_audio"])

    def test_reference_path_traversal_rejected(self):
        self.regions()
        archive = self.studio.export()
        library = VoiceLibrary(archive.with_suffix(""))
        library.manifest["profiles"][0]["references"][0]["path"] = "../../outside.wav"
        with self.assertRaises(ValueError):
            library.reference(self.profile["id"])

    def test_ambiguous_asr_assignment_is_not_guessed(self):
        record = self.regions([
            {"start": 0, "end": 3, "speaker": "A", "channel": 0, "purity": "reviewed_single_voice"},
            {"start": 0, "end": 3, "speaker": "B", "channel": 1, "purity": "reviewed_single_voice"},
        ])
        record["transcription"] = {"segments": [{"start": 1, "end": 2, "text": "Hello", "words": [
            {"start": 1, "end": 2, "word": "Hello", "probability": 0.9}]}]}
        word = self.studio.transcript_rows(record)[0]
        self.assertIsNone(word["speaker"])
        self.assertEqual("ambiguous", word["assignment"])
        self.assertEqual(["A", "B"], word["overlap_speakers"])

    def test_exports_do_not_invent_transcripts(self):
        self.regions([{"start": 0, "end": 3, "speaker": "A", "channel": 0, "purity": "reviewed_single_voice"}])
        archive = self.studio.export()
        self.assertEqual("", (archive.with_suffix("") / "transcript.jsonl").read_text())

    def test_overlapping_asr_word_is_ambiguous_even_with_timing_dominance(self):
        record = self.regions([
            {"start": 0, "end": 3, "speaker": "A", "channel": None, "purity": "model_nonoverlap"},
            {"start": 1.5, "end": 3, "speaker": "B", "channel": None, "purity": "model_nonoverlap"}])
        record["transcription"] = {"segments": [{"start": 1, "end": 2, "text": "Hello"}]}
        word = self.studio.transcript_rows(record)[0]
        self.assertIsNone(word["speaker"])
        self.assertEqual("ambiguous", word["assignment"])

    def test_reanalysis_clears_identity_bindings_for_new_speaker_labels(self):
        self.regions()
        record = self.studio.analyze(self.record["id"], "reference")
        self.assertEqual({}, record["bindings"])

    def test_deleted_speaker_bindings_are_removed(self):
        self.regions()
        record = self.studio.save_segments(self.record["id"], [])
        self.assertEqual({}, record["bindings"])

    def test_ids_and_export_selection_are_validated(self):
        with self.assertRaises(ValueError):
            self.studio.record_path("../../etc/passwd")
        with self.assertRaises(ValueError):
            self.studio.export(["voice_missing"])

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg unavailable")
    def test_compressed_audio_decoding(self):
        path = self.root / "sample.mp3"
        subprocess.run([shutil.which("ffmpeg"), "-nostdin", "-v", "error", "-i", str(self.input), "-y", str(path)], check=True)
        sr, data = audio.read_audio(path)
        self.assertEqual(2, data.shape[1])
        self.assertAlmostEqual(6, len(data) / sr, delta=0.1)


class ResearchTests(unittest.TestCase):
    def test_search_returns_candidates_without_adopting_facts(self):
        def response(url):
            if "wikipedia" in url:
                return {"query": {"search": [{"title": "Aster (character)", "snippet": "<b>Aster</b> is fictional"}]}}
            return {"search": [{"id": "Q123", "label": "Aster", "description": "fictional navigator"}]}
        with patch("voice_studio.research.get_json", side_effect=response):
            result = research.search_character("Aster")
        self.assertEqual(2, len(result["results"]))
        self.assertNotIn("biography", result)
        self.assertNotIn("<b>", result["results"][0]["description"])

    def test_wikidata_retains_units_precision_qualifiers_and_references(self):
        entity = {"entities": {"Q123": {"labels": {"en": {"value": "Aster"}}, "claims": {
            "P2048": [{"rank": "normal", "id": "statement1", "mainsnak": {"snaktype": "value", "datatype": "quantity", "datavalue": {"value": {"amount": "+1.7", "unit": "http://www.wikidata.org/entity/Q11573"}}}, "qualifiers": {"edition": "v2"}, "references": [{"hash": "reference1"}]}],
            "P569": [{"rank": "normal", "mainsnak": {"snaktype": "value", "datatype": "time", "datavalue": {"value": {"time": "+2000-00-00T00:00:00Z", "precision": 9}}}}]
        }}}}
        with patch("voice_studio.research.get_json", return_value=entity):
            result = research.wikidata("Q123")
        height = next(c for c in result["claims"] if c["property"] == "P2048")
        birth = next(c for c in result["claims"] if c["property"] == "P569")
        self.assertIn("Q11573", height["value"]["unit"])
        self.assertEqual({"edition": "v2"}, height["qualifiers"])
        self.assertTrue(height["references"])
        self.assertEqual(9, birth["value"]["precision"])
        self.assertEqual("unreviewed", birth["review_status"])

    def test_nonpublic_research_urls_rejected(self):
        for url in ("file:///etc/passwd", "javascript:alert(1)", "http://user:secret@example.org"):
            with self.assertRaises(ValueError):
                research.safe_url(url)
        with patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("127.0.0.1", 80))]):
            with self.assertRaises(ValueError):
                research.safe_url("http://localhost/private")

    def test_html_script_text_is_not_imported(self):
        result = research.extract_document(b"<html><title>Canon</title><script>steal()</script><p>Aster</p></html>", "canon.html")
        self.assertIn("Aster", result["text"])
        self.assertNotIn("steal()", result["text"])

    def test_timestamp_carries_rounding_over_minute(self):
        self.assertEqual("00:01:00,000", timestamp(59.9999))


if __name__ == "__main__":
    unittest.main(verbosity=2)
