import hashlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("windows_builder", Path(__file__).with_name("build-full-rezz-windows.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class WindowsBuilderTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
