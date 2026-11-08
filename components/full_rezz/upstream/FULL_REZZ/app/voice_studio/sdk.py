"""Small downstream interface for reference retrieval and expression requests."""
from __future__ import annotations

import json
import hashlib
import math
import re
from pathlib import Path
from xml.sax.saxutils import escape


class VoiceLibrary:
    def __init__(self, folder: str | Path):
        self.root = Path(folder).resolve()
        self.manifest = json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest.get("schema_version") not in ("1.0.0", "1.1.0"):
            raise ValueError("Unsupported voice-reference schema.")

    def profile(self, profile_id: str) -> dict:
        for profile in self.manifest["profiles"]:
            if profile["id"] == profile_id:
                return profile
        raise ValueError("Voice profile not found.")

    def reference(self, profile_id: str, style: str = "neutral") -> dict:
        if not isinstance(style, str) or not style.strip() or len(style) > 80:
            raise ValueError("Supply a reference style of 1–80 characters.")
        profile = self.profile(profile_id)
        references = [r for r in profile["references"] if r.get("quality", {}).get("status") != "reject"]
        if not references:
            raise ValueError("This voice has no eligible references. Review and assign clean regions first.")
        def rank(ref):
            duration = ref["duration_seconds"]
            return (ref.get("quality", {}).get("status") == "signal_checks_passed",
                    ref["measurements"]["clipping_fraction"] < 0.001, ref["sample_rate_hz"] >= 22050, ref["style"] == style,
                    3 <= duration <= 12, min(duration, 12))
        chosen = dict(max(references, key=rank))
        path = (self.root / chosen["path"]).resolve()
        if not path.is_relative_to(self.root) or not path.is_file():
            raise ValueError("Reference path is missing or outside the voice library.")
        expected = chosen.get("sha256")
        if expected and hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError("Reference integrity checksum failed: the audio changed after export.")
        chosen["absolute_path"] = str(path)
        return chosen

    def expression_request(self, profile_id: str, text: str, style: str = "neutral",
                           rate: float = 1.0, pitch_semitones: float = 0.0,
                           volume_db: float = 0.0) -> dict:
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            raise ValueError("Supply 1–20,000 characters of speech text.")
        if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]", text):
            raise ValueError("Speech text contains characters that cannot be represented in SSML.")
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
               for v in (rate, pitch_semitones, volume_db)):
            raise ValueError("Prosody parameters must be finite numbers.")
        if not 0.5 <= rate <= 2 or not -12 <= pitch_semitones <= 12 or not -20 <= volume_db <= 6:
            raise ValueError("Prosody parameters are outside their supported ranges.")
        ref = self.reference(profile_id, style)
        profile = self.profile(profile_id)
        ssml = (f'<speak><prosody rate="{rate * 100:g}%" pitch="{pitch_semitones:+g}st" '
                f'volume="{volume_db:+g}dB">{escape(text)}</prosody></speak>')
        return {"schema_version": "1.0.0", "kind": "voice_expression_request", "profile_id": profile_id,
                "text": text, "requested_style": style, "reference_style": ref["style"],
                "style_match": ref["style"] == style, "reference": ref,
                "prosody": {"rate_multiplier": rate, "pitch_semitones": pitch_semitones, "volume_db": volume_db},
                "character": profile.get("character", {}), "character_context": profile.get("character_context", {}),
                "sources": profile.get("sources", []),
                "ssml": ssml, "renderer": None, "generated_audio": None,
                "renderer_contract": "Pass reference audio and text to a compatible synthesis adapter; SSML support and speaker conditioning depend on that adapter."}
