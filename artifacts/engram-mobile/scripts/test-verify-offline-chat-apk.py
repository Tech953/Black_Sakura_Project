import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

loader = importlib.util.spec_from_file_location(
    "verify_apk", Path(__file__).with_name("verify-offline-chat-apk.py"))
module = importlib.util.module_from_spec(loader)
loader.loader.exec_module(module)


class ApkTests(unittest.TestCase):
    def make_apk(self, root, compression=zipfile.ZIP_STORED, corrupt=False):
        model = b"GGUF-test-model"
        license_bytes = b"test license"
        spec = {"filename": "test.gguf", "bytes": len(model),
                "sha256": hashlib.sha256(model).hexdigest(),
                "licenseSha256": hashlib.sha256(license_bytes).hexdigest()}
        apk = Path(root) / "test.apk"
        with zipfile.ZipFile(apk, "w", compression=compression) as archive:
            archive.writestr("assets/offline-model/test.gguf",
                             b"GGUF-bad--model" if corrupt else model)
            archive.writestr("assets/offline-model/manifest.json", json.dumps(spec))
            archive.writestr("assets/offline-model/LICENSE.txt", license_bytes)
            archive.writestr("assets/offline-model/NOTICE.txt", "notice")
        return apk, spec

    def test_verified_model_is_not_speech_acceptance(self):
        with tempfile.TemporaryDirectory() as root:
            apk, spec = self.make_apk(root)
            result = module.verify(apk, spec)
            self.assertTrue(result["chatModelVerified"])
            self.assertFalse(result["speechVerified"])
            self.assertFalse(result["nativeOfflineAccepted"])

    def test_compressed_or_corrupt_models_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            for options in ({"compression": zipfile.ZIP_DEFLATED}, {"corrupt": True}):
                apk, spec = self.make_apk(root, **options)
                with self.assertRaises(ValueError):
                    module.verify(apk, spec)

    def test_model_missing_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root) / "empty.apk"
            with zipfile.ZipFile(apk, "w"):
                pass
            with self.assertRaisesRegex(ValueError, "exactly one"):
                module.verify(apk, {"filename": "missing.gguf"})

    def test_full_rezz_reference_audio_is_rejected_but_ui_audio_is_not(self):
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root) / "reference-audio.apk"
            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/full-rezz/reference-audio/rebecca.wav", b"private")
                archive.writestr(r"Assets\FULL-REZZ\reference-audio\voice.WAV", b"private")
                archive.writestr("assets/sounds/notification.wav", b"ui sound")
            with zipfile.ZipFile(apk) as archive:
                with self.assertRaisesRegex(ValueError, "local-only"):
                    module.verify_reference_audio_excluded(archive)

            with zipfile.ZipFile(apk, "w") as archive:
                archive.writestr("assets/full-rezz/models/vocos.bin", b"model")
                archive.writestr("assets/sounds/notification.wav", b"ui sound")
            with zipfile.ZipFile(apk) as archive:
                module.verify_reference_audio_excluded(archive)

    def test_packaged_policy_must_be_local(self):
        manifest = ('A: package="ai.pyri.engram.offline"\n'
                    'A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false\n')
        self.assertFalse(module.verify_manifest_dump(manifest)["networkPermissions"])
        for bad in (
            manifest.replace(".offline", ""),
            manifest.replace("=false", "=true"),
            manifest + ':debuggable(0x0101000f)=true\n',
            manifest + '"android.permission.INTERNET"\n',
        ):
            with self.assertRaises(ValueError):
                module.verify_manifest_dump(bad)


if __name__ == "__main__":
    unittest.main()
