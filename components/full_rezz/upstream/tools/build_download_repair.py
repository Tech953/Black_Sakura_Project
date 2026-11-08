"""Create checked, ordinary ZIP downloads for the FULL_REZZ 3.0 release.

Only transport and the compact developer fileset are changed. The complete
Windows executable and complete source archive remain byte-for-byte intact.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import tempfile
import zipfile

REVISION = "2026-10-14.3-download-repair"
CHUNK_BYTES = 190_000_000
EXPECTED_SOURCE = "95759e8b5acc3c3040826b2d9bffc0ca5e0eaa4c53326640607efda419168762"
EXPECTED_REPLIT = "9cdb04787eac15e87baed233fce078c86e0f076d0ff2c0b2c7869c1cdd8efa4e"
README = """FULL_REZZ 3.0 download recovery

Use these new ZIP downloads together. They replace the earlier raw .part
transport files. Downloading is separate from installing.

SOURCE FOR REPLIT / CODE REVIEW
Extract FULL_REZZ_3.0_Replit_Source_Core.zip into a new folder. main.py,
.replit, tests, and full_rezz_bridge are directly at the archive root.
Open that folder as the project root; run python3 main.py.
The portable demonstration reports a 60 fps, 720-frame plan. It explicitly
does not run neural inference or generate a new animation. Its basic demo
uses Python's standard library. Desktop/render/neural development has its
own documented requirements. This is source code, not the installed app.

The compact archive retains every Python source file, active guides, fonts,
authored character assets, and the reference-pack fixtures. It omits bulky
historic recordings/review movies, generated sample-workspace audio and arrays, Windows vendor binaries,
the embedded-Python download, and third-party corresponding-source archives.
CORE_OMISSIONS.json lists every omission. Get the complete source below if
those archival materials or redistribution sources are needed.

WINDOWS INSTALLER
1. Download all 15 FULL_REZZ_3.0_Installer_NN_of_15.zip files.
2. Extract FULL_REZZ_3.0_Recovery_Tools.zip into the SAME folder as those ZIPs.
3. Leave the 15 installer ZIPs zipped. Double-click Assemble_Installer.cmd.
4. It reads the ZIPs, checks every download, and creates the complete
   FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe. Run that EXE to install.

The assembler uses Windows' built-in PowerShell and .NET. No Python, Node,
7-Zip, model service, network connection, or account is used for assembly.
The installed application contains its own runtime and model assets.
Keep ZIP filenames unchanged; do not mix these ZIPs with older .part files.
If a download is missing or damaged, the assembler names it and stops.
It leaves a readable assembly log and does not overwrite a different EXE.
Allow about 15 GB of free disk space for downloads, assembly, and installation.

COMPLETE SOURCE ARCHIVE
Download all 3 FULL_REZZ_3.0_Full_Source_NN_of_03.zip files into the tools
folder. Leave them zipped and run Assemble_Full_Source.cmd. This creates
FULL_REZZ_3.0_Source.zip, exactly matching the complete original source.
This step is optional when only the compact Replit source is needed.

VERIFICATION AND LIMITS
ZIP CRCs, individual SHA256 checksums, and both reconstructed outputs are
checked. Ordinary ZIP containers are each under 200 MB (decimal).
The installer is unsigned. Native Windows install/upgrade/uninstall, device
audio/GPU operation, signed-in Replit execution, and host ENGRAM integration
are not certified by these transport checks. Artistic/voice fidelity review
also remains separate. A checksum pass is not a Windows execution test.

If Windows fails after assembly, keep FULL_REZZ_Assembly_installer.log and
the exact error text. Do not disable Windows protections to address an error.
"""


def digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def dump(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def zip_info(name: str, compression=zipfile.ZIP_DEFLATED) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, (2026, 10, 14, 12, 0, 0))
    info.compress_type = compression
    info.external_attr = 0o100644 << 16
    return info


def make_transport(source: Path, kind: str, staging: Path) -> dict:
    size = source.stat().st_size
    total = math.ceil(size / CHUNK_BYTES)
    label = "Installer" if kind == "installer" else "Full_Source"
    result = {"name": source.name, "bytes": size, "sha256": digest(source), "bundles": []}
    with source.open("rb") as input_file:
        for number in range(1, total + 1):
            payload = input_file.read(CHUNK_BYTES)
            entry = f"FULL_REZZ_{kind}_{number:02d}.chunk"
            name = f"FULL_REZZ_3.0_{label}_{number:02d}_of_{total:02d}.zip"
            path = staging / name
            with zipfile.ZipFile(path, "w", allowZip64=True) as archive:
                archive.writestr(zip_info(entry, zipfile.ZIP_STORED), payload)
                archive.writestr(zip_info("READ_ME.txt"),
                    "Keep this file zipped. Download every matching ZIP and the recovery tools.\n"
                    "Run Assemble_Installer.cmd or Assemble_Full_Source.cmd from the ZIP folder.\n")
            assert path.stat().st_size < 200_000_000
            result["bundles"].append({"name": name, "bytes": path.stat().st_size,
                "sha256": digest(path), "entry": entry, "payload_bytes": len(payload),
                "payload_sha256": hashlib.sha256(payload).hexdigest()})
            print(f"Built {name}", flush=True)
        assert input_file.read(1) == b""
    # Reconstruct from the actual ZIP entries, not from the source input.
    reconstructed = staging / (source.name + ".roundtrip")
    with reconstructed.open("wb") as output:
        for bundle in result["bundles"]:
            path = staging / bundle["name"]
            assert path.stat().st_size == bundle["bytes"] and digest(path) == bundle["sha256"]
            with zipfile.ZipFile(path) as archive:
                assert archive.testzip() is None
                with archive.open(bundle["entry"]) as stream:
                    content_hash = hashlib.sha256()
                    count = 0
                    while block := stream.read(8 * 1024 * 1024):
                        count += len(block)
                        content_hash.update(block)
                        output.write(block)
                assert count == bundle["payload_bytes"]
                assert content_hash.hexdigest() == bundle["payload_sha256"]
    assert reconstructed.stat().st_size == size
    assert digest(reconstructed) == result["sha256"]
    reconstructed.unlink()
    result["zip_crc_and_roundtrip_verified"] = True
    return result


def core_keep(name: str) -> bool:
    path = PurePosixPath(name)
    if name in {"FILESET_CHECKSUMS.sha256", "FULL_REZZ/SOURCE_CHECKSUMS.sha256"}:
        return False
    if path.suffix in {".npy", ".pyc"}:
        return False
    exclude = {"animation/Rebecca_Full_Action_Player.html",
        "FULL_REZZ/app/examples/Rebecca_Reference.zip", "FULL_REZZ/app/examples/Rebecca_60fps_Player.html"}
    if name in exclude:
        return False
    heavy = ("FULL_REZZ/app/licenses/corresponding_source/", "FULL_REZZ/app/vendor/",
        "FULL_REZZ/app/build/", "FULL_REZZ/app/audit/prior_rebecca_evidence/",
        "FULL_REZZ/app/example_workspace/", 
        "animation/baseline/", "animation/layout_review/",
        "FULL_REZZ/app/animation_review/")
    code = {".py", ".js", ".jsx", ".ts", ".tsx", ".css", ".qss", ".json", ".jsonl",
        ".yaml", ".yml", ".toml", ".md", ".txt", ".csv", ".tsv", ".log", ".cmd", ".bat",
        ".ps1", ".nsi", ".nsh", ".sha256", ".xml", ".sql", ".ini", ".cfg", ".h", ".c", ".cpp", ".cmake"}
    return (not name.startswith(heavy) or path.suffix in code
        or path.name.startswith(("LICENSE", "COPYING", "NOTICE", "README")))


def make_core(source: Path, staging: Path, report: dict) -> Path:
    data: dict[str, bytes] = {}
    omitted = []
    all_python = set()
    with zipfile.ZipFile(source) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            assert info.filename.startswith("FULL_REZZ_Replit/")
            name = info.filename.removeprefix("FULL_REZZ_Replit/")
            assert name and not name.startswith("/") and ".." not in PurePosixPath(name).parts
            if name.endswith(".py"):
                all_python.add(name)
            if core_keep(name):
                data[name] = archive.read(info)
            else:
                omitted.append({"path": name, "bytes": info.file_size})
    assert all_python.issubset(data), "Compact source must retain every Python source file"
    # Current, parsable checksums describe only the files actually in this ZIP.
    data["DOWNLOAD_RECOVERY_README.txt"] = README.encode("utf-8")
    data["CORE_OMISSIONS.json"] = (json.dumps({"delivery_revision": REVISION,
        "original_complete_source_sha256": EXPECTED_SOURCE, "omitted": omitted}, indent=2) + "\n").encode()
    data["tools/build_download_repair.py"] = Path(__file__).read_bytes()
    nested = {n: hashlib.sha256(b).hexdigest() for n, b in data.items() if n.startswith("FULL_REZZ/")}
    data["FULL_REZZ/SOURCE_CHECKSUMS.sha256"] = "".join(f"{h}  {n}\n" for n, h in sorted(nested.items())).encode()
    hashes = {n: hashlib.sha256(b).hexdigest() for n, b in data.items()}
    data["FILESET_CHECKSUMS.sha256"] = "".join(f"{h}  {n}\n" for n, h in sorted(hashes.items())).encode()
    target = staging / "FULL_REZZ_3.0_Replit_Source_Core.zip"
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, content in sorted(data.items()):
            archive.writestr(zip_info(name), content)
    assert target.stat().st_size < 100_000_000, "Inspect compact fileset if it grows past 100 MB"
    extracted = staging / "core_verification"
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        for name, expected in hashes.items():
            assert hashlib.sha256(archive.read(name)).hexdigest() == expected
        archive.extractall(extracted)
    compile_result = subprocess.run([sys.executable, "-m", "compileall", "-q", str(extracted)], capture_output=True, text=True)
    assert compile_result.returncode == 0, compile_result.stdout + compile_result.stderr
    run = subprocess.run([sys.executable, "main.py"], cwd=extracted, capture_output=True, text=True)
    (staging / "FULL_REZZ_3.0_Core_Starter.log").write_text(run.stdout + run.stderr, encoding="utf-8")
    assert run.returncode == 0, run.stderr
    demo = json.loads(run.stdout)
    assert demo["fps"] >= 60 and demo["frame_count"] == 720
    assert demo["inference_performed_on_this_run"] is False
    assert demo["new_animation_generated"] is False
    test = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests", "-v"],
        cwd=extracted, capture_output=True, text=True)
    (staging / "FULL_REZZ_3.0_Core_Tests.log").write_text(test.stdout + test.stderr, encoding="utf-8")
    report["core"] = {"name": target.name, "bytes": target.stat().st_size, "sha256": digest(target),
        "entries": len(data), "retains_every_python_source_file": True,
        "python_source_count": len(all_python), "omitted_archival_or_runtime_files": len(omitted),
        "zip_crc_and_every_entry_sha256_verified": True, "all_python_compiled": True,
        "extracted_starter_passed": True, "starter_result": demo,
        "core_test_exit_code": test.returncode, "core_test_summary": test.stderr[-2500:]}
    # This is a real source fileset check, not an invented pass.
    assert test.returncode == 0, test.stdout + test.stderr
    shutil.rmtree(extracted)
    return target


def powershell_command(kind: str, manifest_sha: str) -> str:
    # A plain -Command avoids downloaded .ps1 execution-policy changes.
    # Keep this one line below Windows CMD's command-length limit.
    statements = [
        "$ErrorActionPreference='Stop'",
        f"$kind='{kind}'",
        "$base=(Get-Location).Path",
        "$stage=$null",
        "$logging=$false",
        "try { "
        "Start-Transcript -Path (Join-Path $base ('FULL_REZZ_Assembly_'+$kind+'.log')) -Force | Out-Null; $logging=$true; "
        "$mp=Join-Path $base 'FULL_REZZ_3.0_Repair_Manifest.json'; "
        f"if((Get-FileHash -LiteralPath $mp -Algorithm SHA256).Hash -ne '{manifest_sha}'){{throw 'The recovery manifest is missing or changed. Extract the matching Recovery_Tools ZIP again.'}}; "
        "$m=Get-Content -LiteralPath $mp -Raw | ConvertFrom-Json; $item=$m.outputs.$kind; "
        "if(-not $item -or [IO.Path]::GetFileName($item.name) -ne $item.name){throw 'Invalid output filename in manifest.'}; "
        "$target=Join-Path $base $item.name; "
        "if(Test-Path -LiteralPath $target){ "
        "if((Get-Item -LiteralPath $target).Length -ne $item.bytes -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $item.sha256){throw 'A different output already exists. Move it to another folder before assembling.'}; "
        "Write-Host ('Already verified: '+$item.name); Stop-Transcript | Out-Null; exit 0 }; "
        "foreach($b in $item.bundles){ "
        "if([IO.Path]::GetFileName($b.name) -ne $b.name){throw 'Invalid ZIP filename in manifest.'}; "
        "$p=Join-Path $base $b.name; Write-Host ('Checking '+$b.name); "
        "if(-not(Test-Path -LiteralPath $p)){throw ('Missing download: '+$b.name)}; "
        "if((Get-Item -LiteralPath $p).Length -ne $b.bytes -or (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash -ne $b.sha256){throw ('Damaged or wrong download: '+$b.name)} }; "
        "Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; "
        "$drive=New-Object -TypeName System.IO.DriveInfo -ArgumentList ([IO.Path]::GetPathRoot($base)); "
        "if($drive.AvailableFreeSpace -lt ($item.bytes+67108864)){throw 'Insufficient free disk space for assembly.'}; "
        "$stage=$target+'.assembling.'+[Guid]::NewGuid().ToString('N'); $out=[IO.File]::Create($stage); "
        "try { foreach($b in $item.bundles){ "
        "Write-Host ('Reading '+$b.name); $z=[IO.Compression.ZipFile]::OpenRead((Join-Path $base $b.name)); "
        "try { $e=$z.GetEntry($b.entry); if(-not $e -or $e.Length -ne $b.payload_bytes){throw ('Invalid content in '+$b.name)}; "
        "$s=$e.Open(); try { $s.CopyTo($out) } finally { $s.Dispose() } "
        "} finally { $z.Dispose() } } } finally { $out.Dispose() }; "
        "if((Get-Item -LiteralPath $stage).Length -ne $item.bytes -or (Get-FileHash -LiteralPath $stage -Algorithm SHA256).Hash -ne $item.sha256){throw 'Reconstructed output checksum failed.'}; "
        "[IO.File]::Move($stage,$target); $stage=$null; Write-Host ('VERIFIED: '+$item.name); "
        "Stop-Transcript | Out-Null; exit 0 "
        "} catch { "
        "Write-Host ('ASSEMBLY FAILED: '+$_.Exception.Message) -ForegroundColor Red; "
        "if($stage -and (Test-Path -LiteralPath $stage)){Remove-Item -LiteralPath $stage -Force}; "
        "if($logging){Stop-Transcript | Out-Null}; exit 1 }",
    ]
    command = "; ".join(statements)
    assert '"' not in command and "%" not in command
    assert len(command) < 7000
    return command


def make_tools(staging: Path, manifest: dict) -> None:
    path = staging / "FULL_REZZ_3.0_Repair_Manifest.json"
    dump(path, manifest)
    sha = digest(path)
    for kind, filename in [("installer", "Assemble_Installer.cmd"), ("source", "Assemble_Full_Source.cmd")]:
        command = powershell_command(kind, sha)
        cmd = ("@echo off\r\nsetlocal\r\npushd \"%~dp0\"\r\n"
            "if errorlevel 1 goto failedfolder\r\n"
            f"echo Verifying and assembling FULL_REZZ {kind}. Please keep this window open.\r\n"
            f'powershell.exe -NoLogo -NoProfile -Command "{command}"\r\n'
            "set result=%errorlevel%\r\npopd\r\necho.\r\n"
            "echo The assembly log is in the downloads folder.\r\npause\r\nexit /b %result%\r\n"
            ":failedfolder\r\necho Could not open the downloads folder. Extract the tools first.\r\npause\r\nexit /b 1\r\n")
        assert max(map(len, cmd.splitlines())) < 8000
        (staging / filename).write_bytes(cmd.encode("ascii"))
        (staging / (filename.removesuffix(".cmd") + ".ps1")).write_text(command.replace("; ", ";\n"), encoding="utf-8-sig")
    (staging / "READ_ME_FIRST.txt").write_text(README, encoding="utf-8")
    with zipfile.ZipFile(staging / "FULL_REZZ_3.0_Recovery_Tools.zip", "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in ["FULL_REZZ_3.0_Repair_Manifest.json", "Assemble_Installer.cmd", "Assemble_Full_Source.cmd",
            "Assemble_Installer.ps1", "Assemble_Full_Source.ps1", "READ_ME_FIRST.txt"]:
            archive.write(staging / name, name)
    with zipfile.ZipFile(staging / "FULL_REZZ_3.0_Recovery_Tools.zip") as archive:
        assert archive.testzip() is None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--originals", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    originals = args.originals.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="full_rezz_repaired_delivery_"))
    old = json.loads((originals / "FULL_REZZ_3.0_Delivery_Manifest.json").read_text())
    source = originals / "FULL_REZZ_3.0_Source.zip"
    assert digest(source) == EXPECTED_SOURCE
    replit = originals / "FULL_REZZ_Replit_Engram_Fileset.zip"
    # Every original byte is recovered before changing transport.
    assert digest(replit) == EXPECTED_REPLIT
    for archive in [source, replit, originals / "FULL_REZZ_3.0_Start_Here.zip"]:
        with zipfile.ZipFile(archive) as z:
            assert z.testzip() is None
    installer = staging / old["installer"]["name"]
    with installer.open("wb") as output:
        for part in old["parts"]:
            path = originals / part["name"]
            assert path.stat().st_size == part["bytes"] and digest(path) == part["sha256"]
            with path.open("rb") as handle:
                shutil.copyfileobj(handle, output, 8 * 1024 * 1024)
    assert installer.stat().st_size == old["installer"]["bytes"]
    assert digest(installer) == old["installer"]["sha256"]
    with zipfile.ZipFile(installer) as z:
        assert z.testzip() is None
        payload_entries = len(z.infolist())
    report = {"delivery_revision": REVISION, "original_saved_bytes_verified": True,
        "original_installer_payload_zip_entries": payload_entries,
        "original_installer_payload_zip_crc_verified": True,
        "native_windows_execution_tested": False, "powershell_executed_on_windows": False,
        "signed_in_replit_execution_tested": False, "host_engram_repository_modified": False}
    make_core(source, staging, report)
    print("Compact source compiled, started, and passed its bridge tests.", flush=True)
    outputs = {"installer": make_transport(installer, "installer", staging),
        "source": make_transport(source, "source", staging)}
    installer.unlink()
    manifest = {"schema": "full-rezz-zip-recovery/v1", "program_version": "3.0.0",
        "delivery_revision": REVISION, "outputs": outputs}
    make_tools(staging, manifest)
    report["outputs"] = outputs
    dump(staging / "FULL_REZZ_3.0_Download_Repair_Verification.json", report)
    files = [staging / "FULL_REZZ_3.0_Replit_Source_Core.zip", staging / "FULL_REZZ_3.0_Recovery_Tools.zip"]
    files += [staging / b["name"] for b in outputs["installer"]["bundles"]]
    files += [staging / b["name"] for b in outputs["source"]["bundles"]]
    files += [staging / "FULL_REZZ_3.0_Download_Repair_Verification.json"]
    guide = ["# FULL_REZZ 3.0 download recovery", "", README, "", "## Downloads", ""]
    for path in files:
        final = args.output.resolve() / path.name
        guide.append(f"- [{path.name}](sandbox:{final}) — {path.stat().st_size:,} bytes")
    guide_path = staging / "FULL_REZZ_3.0_Download_Guide.md"
    guide_path.write_text("\n".join(guide) + "\n", encoding="utf-8")
    files.append(guide_path)
    checksum_path = staging / "FULL_REZZ_3.0_Download_CHECKSUMS.sha256"
    checksum_path.write_text("".join(f"{digest(p)}  {p.name}\n" for p in files), encoding="ascii")
    files.append(checksum_path)
    receipt = []
    # Closed files are installed atomically; no partial archives are exposed.
    for path in files:
        final = args.output.resolve() / path.name
        sha = digest(path)
        os.replace(path, final)
        receipt.append({"local_path": str(final), "bytes": final.stat().st_size, "sha256": sha})
    upload = {"uploads": [{"local_path": r["local_path"], "purpose": "create_library_file", "library_artifact_type": "other"} for r in receipt]}
    dump(staging / "upload_request.json", upload)
    dump(staging / "delivered_files.json", receipt)
    print(json.dumps({"staging": str(staging), "upload_request": str(staging / 'upload_request.json'),
        "receipt": str(staging / 'delivered_files.json'), "files": receipt,
        "core_test_summary": report['core']['core_test_summary'][-500:]}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
