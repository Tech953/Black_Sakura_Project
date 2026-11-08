"""Map exported data without executing source text or character prompts."""
from __future__ import annotations
import copy
from pathlib import Path
from .contracts import ContractError, checked_file, finite, identifier, read_json, sha256, speech_body

class ReferencePack:
    def __init__(self, folder):
        self.root = Path(folder).resolve()
        manifest_path, _ = checked_file(self.root, "manifest.json")
        self.manifest_sha256 = sha256(manifest_path); self.manifest = read_json(manifest_path); m = self.manifest
        if not isinstance(m, dict) or m.get("schema_version") not in ("1.0.0", "1.1.0"):
            raise ContractError("Unsupported FULL_REZZ reference-pack version.")
        identifier(m.get("pack_id"), "pack"); profiles = m.get("profiles")
        if not isinstance(profiles, list) or not 1 <= len(profiles) <= 100: raise ContractError("A pack must contain 1–100 profiles.")
        if not isinstance(m.get("recordings"), list) or not isinstance(m.get("limitations"), list): raise ContractError("Recordings and limitations must be arrays.")
        self._profiles = {}; self._assets = {}; all_sources = {}; all_references = set(); recordings = set()
        for recording in m["recordings"]:
            if not isinstance(recording, dict): raise ContractError("Invalid recording metadata.")
            rid = identifier(recording.get("id"), "rec")
            if rid in recordings: raise ContractError("Duplicate recording identifier.")
            recordings.add(rid)
        for p in profiles:
            if not isinstance(p, dict): raise ContractError("Invalid profile object.")
            pid = identifier(p.get("id"), "voice")
            if pid in self._profiles: raise ContractError("Duplicate profile identifier.")
            if not isinstance(p.get("name"), str) or not 1 <= len(p["name"]) <= 100: raise ContractError("Invalid profile name.")
            if not isinstance(p.get("references"), list) or not isinstance(p.get("sources"), list): raise ContractError("References and sources must be arrays.")
            character = p.get("character")
            if not isinstance(character, dict) or not isinstance(character.get("field_sources", {}), dict): raise ContractError("Authored character context is required.")
            assets = []; source_ids = set()
            for source in p["sources"]:
                if not isinstance(source, dict): raise ContractError("Invalid source metadata.")
                sid = identifier(source.get("id"), "src")
                if sid in source_ids or (sid in all_sources and all_sources[sid] != source): raise ContractError("Duplicate or conflicting source identifier.")
                source_ids.add(sid); all_sources[sid] = source
                if not source.get("text_sha256"): raise ContractError("Source text requires its declared checksum.")
                _, info = checked_file(self.root, source.get("text_path"), source["text_sha256"])
                assets.append({**info, "role": "source_text", "source_id": sid})
                if source.get("original_path"):
                    if not source.get("original_sha256"): raise ContractError("An original source requires its checksum.")
                    _, info = checked_file(self.root, source["original_path"], source["original_sha256"])
                    assets.append({**info, "role": "original_source", "source_id": sid})
            for field, ids in character.get("field_sources", {}).items():
                if not isinstance(field, str) or not isinstance(ids, list) or any(not isinstance(s, str) or s not in source_ids for s in ids):
                    raise ContractError("Character field attribution points to an unknown source.")
            for ref in p["references"]:
                if not isinstance(ref, dict): raise ContractError("Invalid reference metadata.")
                refid = identifier(ref.get("id"), "ref")
                if refid in all_references: raise ContractError("Duplicate reference identifier.")
                all_references.add(refid)
                if ref.get("recording_id") not in recordings: raise ContractError("Reference points to an unknown recording.")
                finite(ref.get("duration_seconds"), .000001, 1800, "reference duration")
                finite(ref.get("sample_rate_hz"), 1000, 384000, "reference sample rate")
                if type(ref["sample_rate_hz"]) is not int: raise ContractError("Sample rate must be an integer.")
                if not isinstance(ref.get("quality", {}), dict) or not isinstance(ref.get("measurements", {}), dict): raise ContractError("Reference quality and measurements must be objects.")
                finite(ref.get("measurements", {}).get("clipping_fraction", 1), 0, 1, "clipping fraction")
                finite(ref.get("source_start_seconds"), 0, 1800, "reference start"); finite(ref.get("source_end_seconds"), 0, 1800, "reference end")
                if ref["source_end_seconds"] <= ref["source_start_seconds"]: raise ContractError("Reference end must follow its start.")
                if not ref.get("sha256"): raise ContractError("Reference audio requires a declared checksum; re-export legacy packs first.")
                _, info = checked_file(self.root, ref.get("path"), ref["sha256"])
                assets.append({**info, "role": "reference_audio", "reference_id": refid})
            context = p.get("character_context")
            if not isinstance(context, dict): raise ContractError("Character context paths are required.")
            for key, role in (("path", "character"), ("prompt_path", "authored_prompt_data"), ("voice_logs_path", "voice_logs")):
                path, info = checked_file(self.root, context.get(key)); assets.append({**info, "role": role})
                if key == "path" and read_json(path) != character: raise ContractError("Manifest character and standalone character JSON disagree.")
            self._profiles[pid] = p; self._assets[pid] = assets

    def profile(self, profile_id):
        try: return copy.deepcopy(self._profiles[profile_id])
        except (KeyError, TypeError) as exc: raise ContractError("Profile does not exist in this pack.") from exc

    @property
    def profile_ids(self): return tuple(self._profiles)

    def select_reference(self, profile_id, style="neutral", require_reviewed=False):
        if not isinstance(style, str) or not style.strip() or len(style) > 80: raise ContractError("Invalid reference style.")
        p = self.profile(profile_id)
        eligible = [r for r in p["references"] if r.get("quality", {}).get("status") != "reject" and 3 <= r["duration_seconds"] <= 12
                    and (not require_reviewed or r.get("review_status") == "reviewed_single_voice")]
        if not eligible: raise ContractError("No eligible 3–12 second reference meets the requested review policy.")
        def rank(r):
            return (r.get("quality", {}).get("status") == "signal_checks_passed", r.get("measurements", {}).get("clipping_fraction", 1) < .001,
                    r["sample_rate_hz"] >= 22050, r.get("style") == style, min(r["duration_seconds"], 12))
        ref = max(eligible, key=rank); checked_file(self.root, ref["path"], ref["sha256"])
        return copy.deepcopy(ref)

    def request(self, profile_id, text, **options):
        body = speech_body(profile_id, text, **options); selected = self.select_reference(profile_id, body["style"])
        return {"bridge_schema_version": "1.0.0", "kind": "full_rezz_render_request", "body": body, "reference_candidate": selected,
                "selection_note": "Candidate is checked now; Studio re-exports and selects its current reference at render time.", "generates_audio": False}

    def to_engram(self, profile_id):
        p = self.profile(profile_id)
        checked_file(self.root, "manifest.json", self.manifest_sha256)
        for asset in self._assets[profile_id]: checked_file(self.root, asset["path"], asset["sha256"])
        return {"bridge_schema_version": "1.0.0", "kind": "full_rezz_engram_context",
                "engram_key": f"full_rezz:{self.manifest['pack_id']}:{profile_id}", "program_version": self.manifest.get("producer_version"),
                "profile_id": profile_id, "name": p["name"], "authored_character": copy.deepcopy(p["character"]),
                "source_evidence": copy.deepcopy(p["sources"]), "profile_snapshot": p, "recording_snapshots": copy.deepcopy(self.manifest["recordings"]),
                "origin": {"pack_id": self.manifest["pack_id"], "schema_version": self.manifest["schema_version"], "producer": self.manifest.get("producer"),
                           "created_at": self.manifest.get("created_at"), "manifest_sha256": self.manifest_sha256},
                "integrity": {"assets": copy.deepcopy(self._assets[profile_id]), "meaning": "Byte integrity, not authenticity or identity. Context files without declared checksums have observed hashes only."},
                "trust": {"source_documents": "untrusted_evidence", "character_prompts": "authored_data_requires_host_policy", "prompts_executed": False,
                          "reasoning_engine_executed": False, "engram_embedding_generated": False},
                "capabilities": {"reference_audio": bool(p["references"]), "authored_context": True, "generated_speech_in_pack": False, "arbitrary_action_generation": False},
                "limitations": copy.deepcopy(self.manifest["limitations"])}
