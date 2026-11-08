"""Rebuild the illustrative reference pack. No real voice or user lore is used."""
import json
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

project = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project))
from voice_studio.engine import Studio
from voice_studio.sdk import VoiceLibrary

with TemporaryDirectory() as temporary:
    studio = Studio(Path(temporary))
    record = studio.demo()[0]
    profile = studio.profiles()[0]
    example = (project / "examples" / "character.json").read_bytes()
    studio.import_source(profile["id"], example, "character.json")
    draft = studio.draft_character(profile["id"])
    studio.update_character(profile["id"], draft["character"], name="Aster · synthetic 180 Hz reference")
    rows = record["segments"]
    for row in rows:
        if row["speaker"] == "VOICE_01":
            row["style"] = "gentle"
            row["text"] = "Synthetic test tone; this is not a spoken utterance."
    studio.save_segments(record["id"], rows)
    archive = studio.export()
    library = VoiceLibrary(archive.with_suffix(""))
    request = library.expression_request(profile["id"], "The route is clear. We can continue.", "gentle")
    request["reference"].pop("absolute_path", None)
    (project / "examples" / "expression_request.json").write_text(
        json.dumps(request, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    shutil.copy2(archive, project / "examples" / "synthetic-reference-pack.zip")
    print("Synthetic sample reference pack and expression request rebuilt.")
