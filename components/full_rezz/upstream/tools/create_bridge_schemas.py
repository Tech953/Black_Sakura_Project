"""Generate the JSON data contracts; cross-field invariants remain in the bridge."""
from pathlib import Path
import json
ROOT = Path(__file__).resolve().parents[1]; OUT = ROOT / "schemas"; OUT.mkdir(exist_ok=True)
ID = {"type": "string", "pattern": "^voice_[a-f0-9]{16}$"}
SHA = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
def obj(properties, required, extra=True):
    return {"type": "object", "properties": properties, "required": required, "additionalProperties": extra}
def write(name, title, value):
    value = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:full-rezz:bridge:" + name + ":1.0.0", "title": title, **value}
    (OUT / (name + ".schema.json")).write_text(json.dumps(value, indent=2) + "\n")
base = {"bridge_schema_version": {"const": "1.0.0"}, "profile_id": ID}
write("engram-context", "FULL_REZZ portable authored engram context", obj({**base,
    "kind": {"const": "full_rezz_engram_context"}, "engram_key": {"type": "string"}, "name": {"type": "string"},
    "authored_character": {"type": "object"}, "source_evidence": {"type": "array", "items": {"type": "object"}},
    "profile_snapshot": {"type": "object"}, "recording_snapshots": {"type": "array"},
    "origin": obj({"pack_id": {"type": "string", "pattern": "^pack_[a-f0-9]{16}$"}, "manifest_sha256": SHA}, ["pack_id", "manifest_sha256"]),
    "integrity": {"type": "object"}, "trust": obj({"prompts_executed": {"const": False}, "reasoning_engine_executed": {"const": False}, "engram_embedding_generated": {"const": False}}, ["prompts_executed", "reasoning_engine_executed", "engram_embedding_generated"]),
    "capabilities": {"type": "object"}, "limitations": {"type": "array", "items": {"type": "string"}}},
    ["bridge_schema_version", "kind", "profile_id", "engram_key", "authored_character", "source_evidence", "profile_snapshot", "origin", "integrity", "trust"]))
body = obj({"profile_id": ID, "text": {"type": "string", "minLength": 1, "maxLength": 500, "pattern": "\\S"},
    "style": {"type": "string", "minLength": 1, "maxLength": 80}, "rate": {"type": "number", "minimum": .5, "maximum": 2},
    "pitch": {"type": "number", "minimum": -12, "maximum": 12}, "volume": {"type": "number", "minimum": -20, "maximum": 6},
    "steps": {"type": "integer", "enum": [16, 32]}, "seed": {"type": "integer", "minimum": 0, "maximum": 2147483647},
    "reference_text": {"type": "string", "maxLength": 2000}, "scene_notes": {"type": "string", "maxLength": 10000},
    "quality_policy": {"enum": ["high_fidelity", "standard"]}}, ["profile_id", "text"], False)
write("render-request", "FULL_REZZ executable render request descriptor", obj({"bridge_schema_version": {"const": "1.0.0"},
    "kind": {"const": "full_rezz_render_request"}, "body": body, "reference_candidate": {"type": "object"}, "generates_audio": {"const": False}},
    ["bridge_schema_version", "kind", "body", "reference_candidate", "generates_audio"]))
write("authored-action", "FULL_REZZ existing authored action descriptor", obj({**base, "kind": {"const": "full_rezz_authored_action"},
    "fps": {"type": "integer", "minimum": 60, "maximum": 240}, "frame_count": {"type": "integer", "minimum": 1, "maximum": 864000},
    "duration_seconds": {"type": "number", "exclusiveMinimum": 0, "maximum": 14400}, "voice_offset_seconds": {"type": "number", "minimum": 0},
    "voice_duration_seconds": {"type": "number", "exclusiveMinimum": 0}, "voice_path": {"type": "string"}, "voice_sha256": SHA,
    "media_path": {"type": "string"}, "media_sha256": SHA, "statement": {"type": "string", "minLength": 1},
    "events": {"type": "array", "minItems": 1, "items": obj({"frame": {"type": "integer", "minimum": 0}, "pose_id": {"type": "string", "minLength": 1}, "time_seconds": {"type": "number", "minimum": 0}}, ["frame", "pose_id"])},
    "automatic_reanimation": {"const": False}}, ["bridge_schema_version", "kind", "profile_id", "fps", "frame_count", "duration_seconds", "voice_offset_seconds", "voice_duration_seconds", "voice_path", "voice_sha256", "media_path", "media_sha256", "statement", "events", "automatic_reanimation"]))
write("verified-render", "FULL_REZZ checked render transport envelope", obj({**base, "kind": {"const": "full_rezz_verified_render"},
    "receipt": obj({"schema_version": {"const": "2.0.0"}, "kind": {"const": "local_voice_render"}, "profile_id": ID, "audio_sha256": SHA, "sample_rate_hz": {"const": 24000}, "review_status": {"enum": ["approved", "needs_revision", "unreviewed"]}}, ["schema_version", "kind", "profile_id", "audio_sha256", "sample_rate_hz", "review_status"]),
    "assets": {"type": "array"}, "integrity_checked": {"const": True}, "audio_decoded_here": {"const": False}, "human_listening_performed_by_adapter": {"const": False}},
    ["bridge_schema_version", "kind", "profile_id", "receipt", "assets", "integrity_checked", "audio_decoded_here", "human_listening_performed_by_adapter"]))
print("Created four bridge schemas")
