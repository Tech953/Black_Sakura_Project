"""Verify actual APK model bytes without extracting another gigabyte-sized copy.

This verifies chat packaging only; it never certifies speech or device behavior.
"""
import hashlib
import argparse
import json
from pathlib import Path
from pathlib import PurePosixPath
import re
import subprocess
import zipfile


REFERENCE_AUDIO_SUFFIXES = {
    ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".aac", ".opus", ".wma",
}


def verify_reference_audio_excluded(archive):
    """Keep private FULL_REZZ reference recordings out of distributed APKs."""
    included = []
    for name in archive.namelist():
        normalized = name.replace("\\", "/")
        has_full_rezz_path = any(
            part.casefold() == "full-rezz"
            for part in PurePosixPath(normalized).parts
        )
        if (
            has_full_rezz_path
            and PurePosixPath(normalized).suffix.casefold()
            in REFERENCE_AUDIO_SUFFIXES
        ):
            included.append(name)
    if included:
        raise ValueError(
            "FULL_REZZ reference audio is local-only and cannot be packaged"
        )


def verify_manifest_dump(text):
    if not re.search(r'A: package="ai\.pyri\.engram\.offline"', text):
        raise ValueError("Packaged application ID is not the local-only sandbox")
    if not re.search(r':allowBackup\(0x[0-9a-f]+\)=false\b', text):
        raise ValueError("Packaged application permits cloud backup")
    if re.search(r':debuggable\(0x[0-9a-f]+\)=true\b', text):
        raise ValueError("Packaged application is debuggable")
    for permission in ("INTERNET", "ACCESS_NETWORK_STATE", "CHANGE_NETWORK_STATE"):
        if f'"android.permission.{permission}"' in text:
            raise ValueError("Packaged application contains network permission")
    return {"applicationId": "ai.pyri.engram.offline",
            "networkPermissions": False, "cloudBackup": False}


def verify(apk, spec=None, aapt2=None):
    if spec is None:
        spec = json.loads((Path(__file__).resolve().parent.parent /
                           "lib/offline/bundled-model-spec.json").read_text())
    entry = "assets/offline-model/" + spec["filename"]
    with zipfile.ZipFile(apk) as archive:
        verify_reference_audio_excluded(archive)
        matches = [item for item in archive.infolist() if item.filename == entry]
        if len(matches) != 1:
            raise ValueError("APK must contain exactly one bundled chat model")
        info = matches[0]
        if info.compress_type != zipfile.ZIP_STORED:
            raise ValueError("GGUF must be stored uncompressed")
        if info.file_size != spec["bytes"]:
            raise ValueError("Bundled chat model size mismatch")
        digest = hashlib.sha256()
        with archive.open(info) as model:
            while chunk := model.read(8 * 1024 * 1024):
                digest.update(chunk)
        if digest.hexdigest() != spec["sha256"]:
            raise ValueError("Bundled chat model SHA-256 mismatch")
        manifest = json.loads(archive.read("assets/offline-model/manifest.json"))
        for key, value in spec.items():
            if manifest.get(key) != value:
                raise ValueError(f"Packaged model manifest mismatch: {key}")
        license_bytes = archive.read("assets/offline-model/LICENSE.txt")
        if hashlib.sha256(license_bytes).hexdigest() != spec["licenseSha256"]:
            raise ValueError("Packaged license mismatch")
        if not archive.read("assets/offline-model/NOTICE.txt").strip():
            raise ValueError("Packaged notice missing")
    policy = None
    if aapt2:
        result = subprocess.run(
            [str(aapt2), "dump", "xmltree", "--file", "AndroidManifest.xml", str(apk)],
            check=True, capture_output=True, text=True)
        policy = verify_manifest_dump(result.stdout)
    return {"apk": str(apk), "chatModelVerified": True, "packagedPolicy": policy,
            "speechVerified": False, "nativeOfflineAccepted": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--aapt2", type=Path, required=True,
                        help="Android build-tools aapt2; inspect the packaged manifest")
    arguments = parser.parse_args()
    print(json.dumps(verify(arguments.apk, aapt2=arguments.aapt2)))
