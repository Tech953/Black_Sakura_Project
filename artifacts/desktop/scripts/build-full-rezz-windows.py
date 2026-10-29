"""Build a Windows-only FULL_REZZ runtime candidate, never an engram database.

Run on native Windows after prepare-full-rezz-assets.mjs. Does not publish a
release. Installed wheels retain their dist-info license material and pip reports.
Final installer/legal/source-offer and application acceptance remain separate.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import zipfile

PYTHON_URL = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"
PYTHON_SHA = "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b"
F5_SHA = "b65de138b25e35fb1896a511279298c904088bb5f33f39ce83d5e7706993e93b"


def sha256(file):
    with Path(file).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ENGRAM-offline-builder"}), timeout=120) as response:
        return json.load(response)


def download(url, dest, expected=None):
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    partial = dest.with_name(dest.name + ".partial")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ENGRAM-offline-builder"}), timeout=180) as response, partial.open("wb") as output:
            shutil.copyfileobj(response, output, 1024 * 1024)
        digest = sha256(partial)
        if expected and digest != expected:
            raise ValueError(f"Unexpected SHA-256 for {dest.name}")
        partial.replace(dest)
        return {"path": dest.name, "sha256": digest, "bytes": dest.stat().st_size, "url": url}
    finally:
        partial.unlink(missing_ok=True)


def unzip(archive, root):
    root = Path(root).resolve()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            relative = member.filename.replace("\\", "/")
            if relative.startswith("/") or ":" in relative or ".." in relative.split("/"):
                raise ValueError("Archive path escaped runtime")
            target = (root / relative).resolve()
            if not target.is_relative_to(root):
                raise ValueError("Archive path escaped runtime")
        bundle.extractall(root)


def inventory(root):
    root = Path(root)
    return [{"path": file.relative_to(root).as_posix(), "bytes": file.stat().st_size, "sha256": sha256(file)}
            for file in sorted(root.rglob("*")) if file.is_file() and file.name != "manifest.json"]


def manifest(root):
    (Path(root) / "manifest.json").write_text(json.dumps({"assets": inventory(root)}, indent=2), encoding="utf-8")


def font_assets(root, records):
    fonts = root / "fonts"
    families = {
        "NotoSans": ("notosans", "NotoSans[wdth,wght].ttf"),
        "NotoNaskhArabic": ("notonaskharabic", "NotoNaskhArabic[wght].ttf"),
        "NotoSansDevanagari": ("notosansdevanagari", "NotoSansDevanagari[wdth,wght].ttf"),
    }
    revision = get_json("https://api.github.com/repos/google/fonts/commits/main")["sha"]
    for name, (directory, file) in families.items():
        base = f"https://raw.githubusercontent.com/google/fonts/{revision}/ofl/{directory}/"
        records.append(download(base + urllib.parse.quote(file), fonts / (name + ".ttf")))
        records.append(download(base + "OFL.txt", fonts / (name + "-OFL.txt")))
    revision = get_json("https://api.github.com/repos/notofonts/noto-cjk/commits/main")["sha"]
    base = f"https://raw.githubusercontent.com/notofonts/noto-cjk/{revision}/Sans/"
    records.append(download(base + "OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf", fonts / "NotoSansCJKsc-Regular.otf"))
    records.append(download(base + "LICENSE", fonts / "NotoCJK-OFL.txt"))
    manifest(fonts)


def vendor_assets(root, temporary, records):
    release = get_json("https://api.github.com/repos/espeak-ng/espeak-ng/releases/tags/1.52.0")
    asset = next(item for item in release["assets"] if item["name"] == "espeak-ng.msi")
    installer = temporary / "espeak-ng.msi"
    records.append(download(asset["browser_download_url"], installer, (asset.get("digest") or "").removeprefix("sha256:") or None))
    extracted = temporary / "espeak"
    result = subprocess.run(["msiexec.exe", "/a", str(installer), "/qn", f"TARGETDIR={extracted}"], check=False)
    if result.returncode not in (0, 3010):
        raise RuntimeError(f"eSpeak administrative extraction failed: {result.returncode}")
    executable = next(extracted.rglob("espeak-ng.exe"))
    destination = root / "vendor/espeak-ng"
    shutil.copytree(executable.parent, destination)
    if not (destination / "espeak-ng-data").is_dir():
        raise RuntimeError("eSpeak voice data was not extracted beside its executable")
    records.append(download("https://raw.githubusercontent.com/espeak-ng/espeak-ng/1.52.0/COPYING",
                            destination / "COPYING"))
    records.append(download("https://github.com/espeak-ng/espeak-ng/archive/refs/tags/1.52.0.tar.gz",
                            root / "licenses/corresponding_source/espeak-ng-1.52.0.tar.gz"))
    manifest(destination)

    release = get_json("https://api.github.com/repos/ggml-org/llama.cpp/releases/tags/b7371")
    asset = next(item for item in release["assets"] if item["name"].endswith("bin-win-cpu-x64.zip"))
    archive = temporary / asset["name"]
    records.append(download(asset["browser_download_url"], archive, (asset.get("digest") or "").removeprefix("sha256:") or None))
    destination = root / "vendor/llama-cpp"
    unzip(archive, destination)
    # Upstream archives sometimes contain one enclosing directory.
    executable = next(destination.rglob("llama-cli.exe"))
    if executable.parent != destination:
        for file in executable.parent.iterdir():
            if file.is_file():
                shutil.copy2(file, destination / file.name)
    records.append(download("https://raw.githubusercontent.com/ggml-org/llama.cpp/b7371/LICENSE",
                            destination / "LICENSE"))
    manifest(destination)

    revision = "9217f5db79a29953eb74d5343926648285ec7e67"
    repository = "Qwen/Qwen2.5-0.5B-Instruct-GGUF"
    metadata = get_json(f"https://huggingface.co/api/models/{repository}/revision/{revision}?blobs=true")
    file = next(item for item in metadata["siblings"] if item["rfilename"] == "qwen2.5-0.5b-instruct-q4_k_m.gguf")
    target = root / "models/companion" / file["rfilename"]
    records.append(download(f"https://huggingface.co/{repository}/resolve/{revision}/{file['rfilename']}",
                            target, file["lfs"]["sha256"]))
    records.append(download(f"https://huggingface.co/{repository}/resolve/{revision}/LICENSE",
                            root / "licenses/Qwen-companion-LICENSE.txt"))
    manifest(root / "models")


def build(source, output):
    if os.name != "nt":
        raise RuntimeError("This builder requires native Windows; Linux/Wine is not native acceptance.")
    source, output = Path(source).resolve(), Path(output).resolve()
    if source == output or output.exists():
        raise ValueError("Use a new output directory, separate from the verified source stage")
    here = Path(__file__).resolve().parent
    subprocess.run(["node", str(here / "prepare-full-rezz-assets.mjs"), "--verify", str(source)], check=True)
    shutil.copytree(source, output, ignore=shutil.ignore_patterns("asset-stage.json"))
    records = []
    try:
        with tempfile.TemporaryDirectory(prefix="full-rezz-windows-") as directory:
            temporary = Path(directory)
            archive = temporary / "python.zip"
            records.append(download(PYTHON_URL, archive, PYTHON_SHA))
            python = output / "python"
            unzip(archive, python)
            site = python / "Lib/site-packages"
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--no-compile",
                            "--target", str(site), "--report", str(output / "windows-pip-report.json"),
                            "--extra-index-url", "https://download.pytorch.org/whl/cpu",
                            "-r", str(here / "full-rezz-windows-requirements.txt")], check=True)
            wheel = next(item for item in get_json("https://pypi.org/pypi/f5-tts/1.1.9/json")["urls"]
                         if item["filename"].endswith(".whl"))
            package = temporary / wheel["filename"]
            records.append(download(wheel["url"], package, F5_SHA))
            subprocess.run([sys.executable, "-m", "pip", "install", "--no-cache-dir", "--no-compile",
                            "--no-deps", "--target", str(site), str(package)], check=True)
            module = site / "f5_tts/model/__init__.py"
            original = module.read_text(encoding="utf-8")
            statement = "from f5_tts.model.trainer import Trainer"
            if statement not in original:
                raise RuntimeError("Unexpected F5 module: inference-only patch cannot be applied")
            module.write_text(original.replace(statement, "# Training-only Trainer import omitted for offline inference."), encoding="utf-8")
            (python / "python311._pth").write_text("python311.zip\n.\nLib/site-packages\n..\nimport site\n", encoding="utf-8")
            for dll in (site / "PySide6").glob("*140*.dll"):
                shutil.copy2(dll, python / dll.name)
            font_assets(output, records)
            vendor_assets(output, temporary, records)
            notice = output / "WINDOWS_RUNTIME_NOTICE.md"
            notice.write_text(
                "Personal, noncommercial engineering candidate; not a final installer.\n"
                "F5-TTS 1.1.9: MIT code; training-only Trainer import omitted. Weights unchanged, CC-BY-NC-4.0.\n"
                "CPython 3.11.9 retains python/LICENSE.txt. Wheel license metadata is retained in site-packages.\n"
                "Noto fonts: OFL-1.1. eSpeak NG: GPL-3.0-or-later, corresponding source included.\n"
                "Qt/PySide and FFmpeg dependency/source compliance still requires final distribution audit.\n"
                "Neutral diagnostic speech is not Rebecca and is never bound as her profile.\n",
                encoding="utf-8")
            subprocess.run([str(python / "python.exe"), str(here / "probe-full-rezz-windows.py"),
                            str(output)], check=True, timeout=1200)
            result = {"runtimeProbePassed": True, "finalInstaller": False, "nativeFreshInstallAccepted": False,
                      "distributionAuditComplete": False, "inputDownloads": records,
                      "files": inventory(output)}
            (output / "windows-runtime-manifest.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    except BaseException:
        (output / "windows-runtime-manifest.json").unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    build(args.source, args.out)
