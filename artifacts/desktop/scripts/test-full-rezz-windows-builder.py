import hashlib
import importlib.util
import io
from pathlib import Path
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import urllib.error
import zipfile

spec = importlib.util.spec_from_file_location("windows_builder", Path(__file__).with_name("build-full-rezz-windows.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class WindowsBuilderTests(unittest.TestCase):
    def test_espeak_corresponding_source_is_pinned_to_codeload(self):
        self.assertEqual(
            builder.ESPEAK_SOURCE_URL,
            "https://codeload.github.com/espeak-ng/espeak-ng/tar.gz/refs/tags/1.52.0",
        )
        self.assertEqual(builder.ESPEAK_SOURCE_BYTES, 17739803)
        self.assertEqual(
            builder.ESPEAK_SOURCE_SHA256,
            "bb4338102ff3b49a81423da8a1a158b420124b055b60fa76cfb4b18677130a23",
        )

    def test_get_json_retries_transient_gateway_timeout(self):
        timeout = urllib.error.HTTPError(
            "https://example.invalid/metadata", 504, "Gateway Timeout", {}, io.BytesIO()
        )
        with patch.object(builder.urllib.request, "urlopen",
                          side_effect=[timeout, io.BytesIO(b'{"sha":"pinned"}')]) as request, \
                patch.object(builder.time, "sleep") as sleep:
            self.assertEqual(builder.get_json("https://example.invalid/metadata"), {"sha": "pinned"})
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_get_json_does_not_retry_permanent_http_failure(self):
        denied = urllib.error.HTTPError(
            "https://example.invalid/metadata", 403, "Forbidden", {}, io.BytesIO()
        )
        with patch.object(builder.urllib.request, "urlopen", side_effect=denied) as request, \
                patch.object(builder.time, "sleep") as sleep:
            with self.assertRaises(urllib.error.HTTPError):
                builder.get_json("https://example.invalid/metadata")
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_runtime_inventory_retains_nested_model_manifests(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "models").mkdir()
            (root / "models/manifest.json").write_text("nested manifest")
            self.assertIn("models/manifest.json", [entry["path"] for entry in builder.inventory(root)])

    def test_normal_zip(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with zipfile.ZipFile(root / "input.zip", "w") as archive:
                archive.writestr("python/python.exe", b"diagnostic fixture")
            builder.unzip(root / "input.zip", root / "output")
            self.assertEqual((root / "output/python/python.exe").read_bytes(), b"diagnostic fixture")

    def test_windows_and_posix_path_escape(self):
        for name in ("../outside", "..\\outside", "C:/outside", "/outside"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                with zipfile.ZipFile(root / "input.zip", "w") as archive:
                    archive.writestr(name, "must not escape")
                with self.assertRaises(ValueError):
                    builder.unzip(root / "input.zip", root / "output")
                self.assertFalse((root / "outside").exists())

    def test_download_hash_failure_leaves_no_success_file(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "asset"
            with patch.object(builder.urllib.request, "urlopen", return_value=io.BytesIO(b"wrong")):
                with self.assertRaises(ValueError):
                    builder.download("https://example.invalid/test", target, "0" * 64)
            self.assertFalse(target.exists())
            self.assertFalse(target.with_name("asset.partial").exists())

    def test_download_hash_success(self):
        data = b"verified fixture"
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "asset"
            with patch.object(builder.urllib.request, "urlopen", return_value=io.BytesIO(data)):
                record = builder.download("https://example.invalid/test", target, hashlib.sha256(data).hexdigest())
            self.assertEqual(target.read_bytes(), data)
            self.assertEqual(record["bytes"], len(data))

    def test_download_retries_transient_gateway_timeout(self):
        data = b"verified fixture"
        timeout = urllib.error.HTTPError(
            "https://example.invalid/asset", 504, "Gateway Timeout", {}, io.BytesIO()
        )
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "asset"
            with patch.object(builder.urllib.request, "urlopen",
                              side_effect=[timeout, io.BytesIO(data)]) as request, \
                    patch.object(builder.time, "sleep") as sleep:
                record = builder.download(
                    "https://example.invalid/asset", target, hashlib.sha256(data).hexdigest()
                )
            self.assertEqual(target.read_bytes(), data)
            self.assertEqual(record["bytes"], len(data))
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(1)

    def test_inventory_records_real_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model.bin").write_bytes(b"data")
            builder.manifest(root)
            records = builder.inventory(root)
            self.assertEqual([record["path"] for record in records], ["model.bin"])
            self.assertEqual(records[0]["sha256"], hashlib.sha256(b"data").hexdigest())

    def test_non_native_execution_fails_before_touching_assets(self):
        with patch.object(builder.os, "name", "posix"):
            with self.assertRaisesRegex(RuntimeError, "native Windows"):
                builder.build("nonexistent-source", "nonexistent-output")

    def test_legacy_ctranslate_requires_compatible_pkg_resources_provider(self):
        requirements = Path(__file__).with_name("full-rezz-windows-requirements.txt").read_text()
        dependencies = {line.strip() for line in requirements.splitlines()
                        if line.strip() and not line.lstrip().startswith("#")}
        self.assertIn("ctranslate2==4.5.0", dependencies)
        self.assertIn("setuptools==80.9.0", dependencies)

    def test_missing_asr_dependency_fails_before_audio_or_synthesis(self):
        runtime = types.ModuleType("voice_studio.runtime")
        runtime.enforce_offline = lambda: None
        runtime.health = lambda full: {"passed": True}
        worker = types.ModuleType("voice_studio.worker")
        worker.run = lambda task: {"passed": True}
        modules = {
            "voice_studio": types.ModuleType("voice_studio"),
            "voice_studio.runtime": runtime,
            "voice_studio.worker": worker,
            "faster_whisper": None,
        }
        probe = Path(__file__).with_name("probe-full-rezz-windows.py")
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(sys.modules, modules), patch.dict(builder.os.environ), \
                    patch.object(sys, "argv", [str(probe), directory]), \
                    patch.object(builder.subprocess, "run") as process:
                with self.assertRaisesRegex(ModuleNotFoundError, "faster_whisper"):
                    runpy.run_path(str(probe), run_name="__main__")
                process.assert_not_called()
                self.assertFalse((Path(directory) / "diagnostic").exists())


if __name__ == "__main__":
    unittest.main()
