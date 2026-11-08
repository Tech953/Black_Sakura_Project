"""Rebuild example descriptors from included production inputs and existing pack."""
from pathlib import Path
import json, hashlib, wave

ROOT = Path(__file__).resolve().parents[1]
def main():
    project = ROOT / "animation" / "project"
    pack = ROOT / "examples" / "rebecca_reference_pack"
    # The ready-to-render inputs and original complete reference pack are staged
    # directly; no second archive or external download is required.
    timeline = ROOT / "animation" / "render_evidence" / "action_timeline.json"
    assert (pack / "manifest.json").is_file()
    (ROOT / "examples/rebecca_timeline.json").write_bytes(timeline.read_bytes())
    (ROOT / "examples/rebecca_statement.wav").write_bytes((project / "assets/statement.original.wav").read_bytes())
    manifest = json.loads((pack / "manifest.json").read_text()); timeline = json.loads((ROOT / "examples/rebecca_timeline.json").read_text())
    srt = (ROOT / "examples/rebecca_statement.srt").read_text()
    statement = " ".join(line.strip() for line in srt.splitlines() if line.strip() and not line.strip().isdigit() and "-->" not in line)
    with wave.open(str(ROOT / "examples/rebecca_statement.wav")) as audio:
        voice_duration = audio.getnframes() / audio.getframerate()
    checksum = lambda p: hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
    descriptor = {"bridge_schema_version": "1.0.0", "kind": "full_rezz_authored_action", "profile_id": manifest["profiles"][0]["id"],
        "fps": 60, "frame_count": 720, "duration_seconds": 12, "voice_offset_seconds": 1.25,
        "voice_duration_seconds": voice_duration, "voice_path": "examples/rebecca_statement.wav", "voice_sha256": checksum("examples/rebecca_statement.wav"),
        "media_path": "animation/Rebecca_Full_Voiced_Action.mp4", "media_sha256": checksum("animation/Rebecca_Full_Voiced_Action.mp4"),
        "statement": statement, "events": timeline["keys"], "automatic_reanimation": False,
        "speech_origin": "Preserved pre-existing demonstration statement; this setup script synthesizes no audio.",
        "lip_sync": "Continuous audio-energy aperture, not phoneme alignment", "canonical_context": "Authored non-canon archive; original finale endpoint retained."}
    (ROOT / "examples/rebecca_action.json").write_text(json.dumps(descriptor, indent=2) + "\n")
    print("Preserved", len(list(pack.rglob('*'))), "pack entries and rebuilt the actual authored 60 fps descriptor")

if __name__ == "__main__": main()
