"""Dependency-free checks at the FULL_REZZ / host-engram boundary."""
from __future__ import annotations
import hashlib, json, math, re
from pathlib import Path, PurePosixPath

class ContractError(ValueError):
    pass

def finite(value, low, high, label):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ContractError(f"{label} must be a finite number in [{low}, {high}].")
    return value

def identifier(value, prefix):
    if not isinstance(value, str) or not re.fullmatch(prefix + r"_[a-f0-9]{16}", value):
        raise ContractError(f"Invalid {prefix} identifier.")
    return value

def digest(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise ContractError("A lowercase SHA256 checksum is required.")
    return value

def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        while block := stream.read(4 * 1024 * 1024): h.update(block)
    return h.hexdigest()

def relative(value):
    if not isinstance(value, str) or not value or value.startswith("/") or "\\" in value or ":" in value or re.search(r'[\x00-\x1f\x7f<>"|?*]', value):
        raise ContractError("Use a safe relative POSIX file path.")
    for part in value.split("/"):
        if part in ("", ".", "..") or part.endswith((" ", ".")) or re.fullmatch(r"(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", part, re.I):
            raise ContractError("Unsafe or Windows-reserved file path.")
    return PurePosixPath(value)

def checked_file(root, value, expected=None):
    root = Path(root).resolve(); rel = relative(value); path = root.joinpath(*rel.parts); cursor = root
    for part in rel.parts:
        cursor = cursor / part
        if cursor.is_symlink(): raise ContractError("Symbolic links are not accepted as portable assets.")
    if not path.resolve().is_relative_to(root) or not path.is_file():
        raise ContractError(f"Missing or out-of-root asset: {value}")
    actual = sha256(path)
    if expected is not None and actual != digest(expected): raise ContractError(f"SHA256 mismatch: {value}")
    return path, {"path": value, "sha256": actual, "size_bytes": path.stat().st_size,
                  "matched_declared_checksum": expected is not None}

def _pairs(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj: raise ContractError(f"Duplicate JSON key: {key}")
        obj[key] = value
    return obj

def parse_json(text):
    def nonfinite(value): raise ContractError(f"Nonfinite JSON number: {value}")
    def number(value):
        value = float(value)
        if not math.isfinite(value): raise ContractError("JSON number exceeds the finite range.")
        return value
    try: return json.loads(text, object_pairs_hook=_pairs, parse_constant=nonfinite, parse_float=number)
    except (ValueError, TypeError) as exc: raise ContractError(f"Invalid JSON: {exc}") from exc

def read_json(path, maximum=8 * 1024 * 1024):
    path = Path(path)
    if path.stat().st_size > maximum: raise ContractError("JSON exceeds the 8 MiB contract limit.")
    return parse_json(path.read_text(encoding="utf-8"))

def speech_body(profile_id, text, *, style="neutral", rate=1.0, pitch=0.0, volume=0.0,
                steps=32, seed=0, reference_text="", scene_notes="", quality_policy="high_fidelity"):
    identifier(profile_id, "voice")
    if not isinstance(text, str) or not text.strip() or len(text) > 500 or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]", text):
        raise ContractError("Speech rendering requires 1–500 valid characters.")
    if not isinstance(style, str) or not style.strip() or len(style) > 80: raise ContractError("Style requires 1–80 characters.")
    finite(rate, .5, 2, "rate"); finite(pitch, -12, 12, "pitch"); finite(volume, -20, 6, "volume")
    if type(steps) is not int or steps not in (16, 32): raise ContractError("Steps must be the integer 16 or 32.")
    if type(seed) is not int or not 0 <= seed <= 2147483647: raise ContractError("Seed must be an integer in [0, 2147483647].")
    for value, bound, label in ((reference_text, 2000, "reference_text"), (scene_notes, 10000, "scene_notes")):
        if not isinstance(value, str) or len(value) > bound: raise ContractError(f"{label} must be a string of at most {bound} characters.")
    if quality_policy not in ("high_fidelity", "standard"): raise ContractError("Unknown reference quality policy.")
    return dict(profile_id=profile_id, text=text, style=style, rate=rate, pitch=pitch, volume=volume,
                steps=steps, seed=seed, reference_text=reference_text, scene_notes=scene_notes, quality_policy=quality_policy)
