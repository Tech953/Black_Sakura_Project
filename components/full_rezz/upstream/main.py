"""Replit Run: inspect supplied character data and the verified 60 fps playback plan."""
import json
from pathlib import Path
from full_rezz_bridge import ReferencePack, action_plan
from full_rezz_bridge.contracts import read_json

def main():
    root = Path(__file__).resolve().parent
    pack = ReferencePack(root / "examples" / "rebecca_reference_pack")
    profile_id = pack.profile_ids[0]; engram = pack.to_engram(profile_id)
    plan = action_plan(root, read_json(root / "examples" / "rebecca_action.json"), profile_id)
    request = pack.request(profile_id, "The offline archive is ready.", style="concern", seed=42)
    print(json.dumps({"program": "FULL_REZZ engram integration demo", "bridge_version": "1.0.0",
        "profile_id": profile_id, "character": engram["name"], "engram_key": engram["engram_key"],
        "canonical_status": engram["authored_character"].get("demographics", {}).get("canonical_status"),
        "source_count": len(engram["source_evidence"]), "checked_asset_count": len(engram["integrity"]["assets"]),
        "fps": plan["descriptor"]["fps"], "frame_count": plan["descriptor"]["frame_count"], "voice_start_frame": plan["voice_start_frame"],
        "distinct_scheduled_poses": plan["distinct_scheduled_poses"], "render_request": request["body"],
        "inference_performed_on_this_run": False, "new_animation_generated": False,
        "next_step": "Read TASK_QUERY.md and docs/INTEGRATION.md; run python3 -m unittest discover -s tests -v."}, indent=2))
    return 0

if __name__ == "__main__": raise SystemExit(main())
