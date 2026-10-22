"""Playback plans for already-authored actions; no new poses or lips are generated."""
from __future__ import annotations
import copy, math
from .contracts import ContractError, checked_file, finite, identifier

def action_plan(root, descriptor, expected_profile_id=None):
    if not isinstance(descriptor, dict) or descriptor.get("bridge_schema_version") != "1.0.0" or descriptor.get("kind") != "full_rezz_authored_action": raise ContractError("Unsupported authored action descriptor.")
    d = copy.deepcopy(descriptor); pid = identifier(d.get("profile_id"), "voice")
    if expected_profile_id is not None and expected_profile_id != pid: raise ContractError("Action belongs to a different profile; use an explicit host ID mapping.")
    fps = d.get("fps"); count = d.get("frame_count")
    if type(fps) is not int or not 60 <= fps <= 240: raise ContractError("Output must be an integer 60–240 fps.")
    if type(count) is not int or not 1 <= count <= 864000: raise ContractError("Invalid frame count.")
    duration = finite(d.get("duration_seconds"), .000001, 14400, "action duration")
    if not math.isclose(count / fps, duration, rel_tol=0, abs_tol=1e-8): raise ContractError("Frame count, fps and duration disagree.")
    offset = finite(d.get("voice_offset_seconds"), 0, duration, "voice offset"); speech_duration = finite(d.get("voice_duration_seconds"), .000001, duration, "voice duration")
    if offset + speech_duration > duration + 1e-8: raise ContractError("Speech would overrun the authored action.")
    if not math.isclose(offset * fps, round(offset * fps), rel_tol=0, abs_tol=1e-8): raise ContractError("Voice onset must lie on the frame grid.")
    if d.get("automatic_reanimation") is not False: raise ContractError("Automatic re-animation is not implemented.")
    if not isinstance(d.get("statement"), str) or not d["statement"].strip(): raise ContractError("An authored statement is required.")
    if not d.get("media_sha256") or not d.get("voice_sha256"): raise ContractError("Authored media and speech require checksums.")
    _, media = checked_file(root, d.get("media_path"), d["media_sha256"]); _, voice = checked_file(root, d.get("voice_path"), d["voice_sha256"])
    events = d.get("events"); last = -1
    if not isinstance(events, list) or not events: raise ContractError("Authored timeline events are required.")
    if not isinstance(events[0], dict) or events[0].get("frame") != 0: raise ContractError("Declare the initial pose at frame zero.")
    for event in events:
        if not isinstance(event, dict) or type(event.get("frame")) is not int or not last < event["frame"] < count: raise ContractError("Timeline frames must be unique, ordered and in range.")
        if not isinstance(event.get("pose_id"), str) or not event["pose_id"]: raise ContractError("Every event needs an authored pose identifier.")
        if "time_seconds" in event:
            finite(event["time_seconds"], 0, duration, "event seconds")
            if not math.isclose(event["frame"] / fps, event["time_seconds"], abs_tol=1e-8): raise ContractError("Timeline seconds and frame index disagree.")
        last = event["frame"]
    return {"bridge_schema_version": "1.0.0", "kind": "full_rezz_playback_plan", "profile_id": pid, "descriptor": d, "assets": [media, voice],
            "voice_start_frame": round(offset * fps), "pose_change_count": len(events), "distinct_scheduled_poses": len({e["pose_id"] for e in events}),
            "media_decoded_here": False, "generates_animation": False, "limits": ["File hashes and playback metadata are checked here; decoding is covered by the independent audit.",
            "New speech remains a separate asset and does not automatically create a performance."]}
