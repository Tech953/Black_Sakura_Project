"""Exercise the actual HTTP app, asynchronous jobs, and downloadable packs."""
import http.client
import io
import json
import re
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path

from voice_studio.engine import Studio
from voice_studio.server import AppServer


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.server = AppServer(("127.0.0.1", 0), Studio(Path(self.temp.name)))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.token = self.server.token

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.server.executor.shutdown(wait=True)
        self.temp.cleanup()

    def request(self, path, body=None, headers=None):
        client = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"X-Studio-Token": self.token}
        h.update(headers or {})
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            h["Content-Type"] = "application/json"
        client.request("POST" if body is not None else "GET", path, body, h)
        response = client.getresponse()
        status, data, meta = response.status, response.read(), dict(response.getheaders())
        client.close()
        return status, data, meta

    def await_job(self, job):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            with self.server.jobs_lock:
                current = dict(self.server.jobs[job["id"]])
            if current["status"] in ("completed", "failed"):
                self.assertEqual("completed", current["status"], current.get("error"))
                return current["result"]
            time.sleep(0.02)
        self.fail("Job did not finish in time")

    def test_interface_assets_and_expected_controls_are_served(self):
        code, html, headers = self.request("/")
        self.assertEqual(200, code)
        self.assertIn(self.token.encode(), html)
        self.assertIn(b"Draft dossier from attached sources", html)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        for path in ("/app.js", "/style.css"):
            code, data, _ = self.request(path)
            self.assertEqual(200, code)
            self.assertTrue(data)

    def test_stale_character_write_is_rejected_over_http(self):
        profile = self.server.studio.new_profile("Aster")
        body = {"profile_id": profile["id"], "character": profile["character"], "expected_revision": 0}
        code, _, _ = self.request("/api/character", body)
        self.assertEqual(200, code)
        code, error, _ = self.request("/api/character", body)
        self.assertEqual(400, code)
        self.assertIn("changed", json.loads(error)["error"])

    def test_cross_site_reads_and_malformed_docx_uploads_are_rejected(self):
        code, _, _ = self.request("/api/state", headers={"Sec-Fetch-Site": "cross-site"})
        self.assertEqual(403, code)
        profile = self.server.studio.new_profile("Aster")
        code, error, _ = self.request(f"/api/source-import?profile_id={profile['id']}&name=bad.docx", b"not a document")
        self.assertEqual(400, code)
        self.assertIn("DOCX", json.loads(error)["error"])

    def test_second_server_cannot_open_the_same_project(self):
        with self.assertRaisesRegex(ValueError, "already open"):
            AppServer(("127.0.0.1", 0), self.server.studio)

    def test_create_author_import_draft_and_export_workflow(self):
        code, data, _ = self.request("/api/jobs", {"kind": "demo"})
        self.assertEqual(202, code)
        result = self.await_job(json.loads(data))
        record_id = result["recording_ids"][0]
        profile = self.server.studio.profiles()[0]
        pid = profile["id"]
        source_data = json.dumps({"character": {"biography": "Navigator Aster", "persona": {"speech_style": "precise"}}}).encode()
        code, data, _ = self.request(f"/api/source-import?profile_id={pid}&name=character.json", source_data)
        self.assertEqual(201, code)
        source_id = json.loads(data)["id"]
        code, data, _ = self.request("/api/jobs", {"kind": "character_draft", "profile_id": pid})
        draft = self.await_job(json.loads(data))
        self.assertEqual("Navigator Aster", draft["character"]["biography"])
        code, data, _ = self.request("/api/character", {"profile_id": pid, "character": draft["character"]})
        self.assertEqual(200, code)
        code, text, _ = self.request(f"/api/source?profile_id={pid}&source_id={source_id}")
        self.assertIn("Navigator Aster", json.loads(text)["text"])
        code, data, _ = self.request("/api/jobs", {"kind": "export"})
        result = self.await_job(json.loads(data))
        code, archive, headers = self.request("/api/exports/" + result["filename"])
        self.assertEqual(200, code)
        self.assertIn("attachment", headers["Content-Disposition"])
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            manifest = json.loads(bundle.read("manifest.json"))
            saved = next(p for p in manifest["profiles"] if p["id"] == pid)
            self.assertEqual("precise", saved["character"]["persona"]["speech_style"])
            self.assertGreater(saved["reference_count"], 0)
            self.assertIn(saved["sources"][0]["original_path"], bundle.namelist())
        code, chunk, headers = self.request("/api/audio/" + record_id, headers={"Range": "bytes=0-43"})
        self.assertEqual(206, code)
        self.assertEqual(44, len(chunk))
        self.assertEqual(b"RIFF", chunk[:4])
        self.assertTrue(headers["Content-Range"].startswith("bytes 0-43/"))

    def test_wrong_origin_token_and_rebinding_host_are_rejected(self):
        for headers in ({"Origin": "https://external.invalid"}, {"X-Studio-Token": "wrong"}, {"Host": "external.invalid"}):
            code, _, _ = self.request("/api/profiles", {"name": "Blocked"}, headers)
            self.assertEqual(403, code)
        self.assertEqual([], self.server.studio.profiles())

    def test_cleanup_quality_and_expression_package_workflow(self):
        _, data, _ = self.request('/api/jobs', {'kind':'demo'})
        rid = self.await_job(json.loads(data))['recording_ids'][0]
        code, _, _ = self.request('/api/audio-settings', {'recording_id':rid,'settings':{'enabled':True}})
        self.assertEqual(200, code)
        _, data, _ = self.request('/api/jobs', {'kind':'quality','recording_id':rid,'start':.5,'end':2.5,'channel':0})
        report = self.await_job(json.loads(data))
        self.assertAlmostEqual(-3, report['output_quality']['peak_dbfs'], places=3)
        code, data, _ = self.request(f'/api/preview?recording_id={rid}&start=.5&end=2.5&channel=0&processed=1')
        self.assertEqual(200, code)
        from scipy.io import wavfile
        import numpy as np
        sr, samples = wavfile.read(io.BytesIO(data))
        self.assertEqual(24000,sr)
        self.assertLessEqual(np.max(np.abs(samples)),.708)
        pid = self.server.studio.profiles()[0]['id']
        _, data, _ = self.request('/api/jobs', {'kind':'expression','profile_id':pid,'text':'Hello'})
        expression = self.await_job(json.loads(data))
        self.assertNotIn('absolute_path',expression['reference'])
        code, data, _ = self.request(expression['reference_package']['download_path'])
        self.assertEqual(200,code)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertIn(expression['reference']['path'],archive.namelist())

    def test_invalid_cleanup_request_does_not_mutate_the_recording(self):
        _, data, _ = self.request('/api/jobs', {'kind':'demo'})
        rid = self.await_job(json.loads(data))['recording_ids'][0]
        revision = self.server.studio.record(rid)['revision']
        code, _, _ = self.request('/api/audio-settings',{'recording_id':rid,'settings':{'enabled':True,'denoise_db':8}})
        self.assertEqual(400,code)
        self.assertEqual(revision,self.server.studio.record(rid)['revision'])

    def test_expression_honors_explicit_low_bandwidth_policy_and_encoding(self):
        import numpy as np
        from scipy.io import wavfile
        studio = self.server.studio
        path = Path(self.temp.name) / "low-rate.wav"
        sr = 8000
        wavfile.write(path, sr, (.2 * np.sin(2 * np.pi * 180 * np.arange(sr) / sr)).astype(np.float32))
        record = studio.import_audio(path)
        profile = studio.new_profile("Reviewed low-bandwidth voice")
        studio.save_segments(record["id"], [{"start": 0, "end": 1, "speaker": "A", "purity": "reviewed_single_voice"}])
        studio.bind(record["id"], "A", profile["id"])
        _, data, _ = self.request('/api/jobs', {"kind": "expression", "profile_id": profile["id"], "text": "Hello",
                                               "encoding": "PCM24", "quality_policy": "standard"})
        expression = self.await_job(json.loads(data))
        self.assertEqual(8000, expression["reference"]["sample_rate_hz"])
        self.assertEqual("PCM_24", expression["reference"]["encoding"])
        code, data, _ = self.request(expression["reference_package"]["download_path"])
        self.assertEqual(200, code)
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            self.assertEqual("standard", manifest["audio_export"]["quality_policy"])
            self.assertIn(expression["reference"]["path"], archive.namelist())

    def test_invalid_job_is_explicit_failure(self):
        _, data, _ = self.request("/api/jobs", {"kind": "unknown"})
        job = json.loads(data)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            with self.server.jobs_lock:
                current = dict(self.server.jobs[job["id"]])
            if current["status"] == "failed":
                self.assertIn("Unknown", current["error"])
                return
            time.sleep(0.02)
        self.fail("The invalid job was not reported as failed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
