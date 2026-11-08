"""Verify a saved FULL_REZZ render without performing inference."""
from __future__ import annotations
import copy
from pathlib import Path
from .contracts import ContractError, checked_file, finite, identifier, read_json, speech_body

def inspect_render(folder, expected_profile_id=None):
    root = Path(folder).resolve(); receipt_path, receipt_info = checked_file(root, "receipt.json"); r = read_json(receipt_path)
    if not isinstance(r, dict) or r.get("schema_version") != "2.0.0" or r.get("kind") != "local_voice_render": raise ContractError("Unsupported render receipt.")
    pid = identifier(r.get("profile_id"), "voice"); identifier(r.get("id"), "render")
    if expected_profile_id is not None and pid != expected_profile_id: raise ContractError("Render belongs to a different profile.")
    request = r.get("request")
    if not isinstance(request, dict) or request.get("profile_id") != pid: raise ContractError("Receipt and request profiles disagree.")
    prosody = request.get("prosody")
    if not isinstance(prosody, dict): raise ContractError("Render request has no prosody.")
    speech_body(pid, request.get("text"), style=request.get("requested_style", "neutral"), rate=prosody.get("rate_multiplier"), pitch=prosody.get("pitch_semitones"),
                volume=prosody.get("volume_db"), steps=r.get("steps"), seed=r.get("seed"), reference_text=r.get("reference_words", ""), scene_notes=r.get("scene_notes", ""))
    finite(r.get("duration_seconds"), .000001, 60, "render duration")
    if r.get("sample_rate_hz") != 24000: raise ContractError("FULL_REZZ 2.0 renders use 24 kHz audio.")
    if r.get("review_status") not in ("unreviewed", "needs_revision", "approved") or not isinstance(r.get("review_history"), list): raise ContractError("Invalid render review metadata.")
    for entry in r["review_history"]:
        if not isinstance(entry, dict) or entry.get("status") not in ("unreviewed", "needs_revision", "approved"): raise ContractError("Invalid render review history entry.")
    if r["review_history"] and r["review_history"][-1]["status"] != r["review_status"]: raise ContractError("Current review and last history entry disagree.")
    reference = request.get("reference")
    if not isinstance(reference, dict): raise ContractError("Missing conditioning reference metadata.")
    if not r.get("audio_sha256") or not reference.get("sha256"): raise ContractError("Render and conditioning reference require checksums.")
    _, speech = checked_file(root, "speech.wav", r["audio_sha256"]); _, ref = checked_file(root, "reference.wav", reference["sha256"])
    return {"bridge_schema_version": "1.0.0", "kind": "full_rezz_verified_render", "profile_id": pid, "receipt": copy.deepcopy(r),
            "assets": [receipt_info, speech, ref], "integrity_checked": True, "audio_decoded_here": False, "review_status": r["review_status"],
            "human_listening_performed_by_adapter": False, "limits": ["A matching hash does not prove pronunciation, acting, speaker identity or human approval.",
            "Review metadata is preserved; the adapter cannot authenticate who entered it."]}
