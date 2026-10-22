"""Persistent local projects and portable, provenance-preserving reference packs."""
from __future__ import annotations

import copy
import csv
import hashlib
import io
import json
import math
import re
import shutil
import threading
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from . import __version__, audio, models, research, quality, spectrum


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def identifier(prefix: str) -> str:
    return prefix + "_" + uuid.uuid4().hex[:16]


def write_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    temporary.replace(path)


def timestamp(seconds: float, comma: bool = True) -> str:
    ms = max(0, round(seconds * 1000))
    hours, ms = divmod(ms, 3600000)
    minutes, ms = divmod(ms, 60000)
    seconds, ms = divmod(ms, 1000)
    return f"{hours:02}:{minutes:02}:{seconds:02}{',' if comma else '.'}{ms:03}"


def _finite(value, name: str) -> float:
    if isinstance(value, bool):
        raise ValueError(f"{name} must be a number, not a boolean.")
    try:
        result = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(f"{name} must be a number.") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite.")
    return result


class Studio:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.records_dir = self.root / "recordings"
        self.records_dir.mkdir(exist_ok=True)
        self.exports_dir = self.root / "exports"
        self.exports_dir.mkdir(exist_ok=True)
        self.sources_dir = self.root / "sources"
        self.sources_dir.mkdir(exist_ok=True)
        self.profiles_file = self.root / "profiles.json"
        self.lock = threading.RLock()
        if not self.profiles_file.exists():
            write_json(self.profiles_file, [])

    def record_path(self, rid: str) -> Path:
        if not re.fullmatch(r"rec_[a-f0-9]{16}", str(rid)):
            raise ValueError("Invalid recording identifier.")
        directory = self.records_dir / rid
        if not (directory / "record.json").is_file():
            raise ValueError("Recording not found.")
        return directory

    def record(self, rid: str) -> dict:
        with self.lock:
            return json.loads((self.record_path(rid) / "record.json").read_text(encoding="utf-8"))

    def records(self) -> list[dict]:
        with self.lock:
            return sorted([json.loads(p.read_text(encoding="utf-8"))
                           for p in self.records_dir.glob("rec_*/record.json")], key=lambda r: r["created_at"])

    def profiles(self) -> list[dict]:
        with self.lock:
            return json.loads(self.profiles_file.read_text(encoding="utf-8"))

    def new_profile(self, name: str, notes: str = "", language: str = "") -> dict:
        name = str(name).strip()
        if not name or len(name) > 100:
            raise ValueError("Give the voice a name of 1–100 characters.")
        with self.lock:
            values = self.profiles()
            profile = {"id": identifier("voice"), "name": name, "notes": str(notes)[:10000],
                       "language": str(language)[:80], "created_at": now(), "revision": 0,
                       "character": research.character_defaults(), "sources": []}
            values.append(profile)
            write_json(self.profiles_file, values)
            return profile

    def _archive_profile(self, profile):
        directory = self.root / "profile_history" / profile["id"]
        directory.mkdir(parents=True, exist_ok=True)
        write_json(directory / f"revision_{profile.get('revision', 0):08d}.json", profile)

    def profile(self, pid: str) -> dict:
        for profile in self.profiles():
            if profile["id"] == pid:
                return profile
        raise ValueError("Voice profile not found.")

    def update_character(self, pid: str, character: dict, name: str | None = None,
                         notes: str | None = None, language: str | None = None,
                         expected_revision: int | None = None) -> dict:
        with self.lock:
            values = self.profiles()
            profile = next((p for p in values if p["id"] == pid), None)
            if profile is None:
                raise ValueError("Voice profile not found.")
            self._check_revision(profile, expected_revision)
            validated = research.validate_character(character, {s["id"] for s in profile.get("sources", [])})
            self._archive_profile(profile)
            profile["character"] = validated
            if name is not None:
                if not str(name).strip() or len(str(name)) > 100:
                    raise ValueError("Give the voice a name of 1–100 characters.")
                profile["name"] = str(name).strip()
            if notes is not None:
                profile["notes"] = str(notes)[:10000]
            if language is not None:
                profile["language"] = str(language)[:80]
            profile["updated_at"] = now()
            profile["revision"] = profile.get("revision", 0) + 1
            write_json(self.profiles_file, values)
            return profile

    def attach_source(self, pid: str, source: dict, original: bytes | None = None,
                      suffix: str = ".txt") -> dict:
        with self.lock:
            values = self.profiles()
            profile = next((p for p in values if p["id"] == pid), None)
            if profile is None:
                raise ValueError("Voice profile not found.")
            sid = identifier("src")
            directory = self.sources_dir / sid
            directory.mkdir()
            try:
                source = copy.deepcopy(source)
                source.update({"id": sid, "retrieved_at": now(), "review_status": "unreviewed"})
                text = source.pop("text", "")
                (directory / "text.txt").write_text(text, encoding="utf-8")
                source["text_sha256"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
                source["text_characters"] = len(text)
                source["text_path"] = f"sources/{sid}/text.txt"
                if original is not None:
                    suffix = suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"
                    (directory / ("original" + suffix)).write_bytes(original)
                    source["original_path"] = f"sources/{sid}/original{suffix}"
                    source["original_sha256"] = hashlib.sha256(original).hexdigest()
                write_json(directory / "source.json", source)
                self._archive_profile(profile)
                profile.setdefault("sources", []).append(source)
                profile["revision"] = profile.get("revision", 0) + 1
                write_json(self.profiles_file, values)
                return source
            except Exception:
                shutil.rmtree(directory)
                raise

    def import_source(self, pid: str, data: bytes, filename: str) -> dict:
        return self.attach_source(pid, research.extract_document(data, filename), data, Path(filename).suffix.lower())

    def collect_source(self, pid: str, provider: str, key: str) -> dict:
        self.profile(pid)
        if provider == "wikipedia":
            return self.attach_source(pid, research.wikipedia(key))
        if provider == "wikidata":
            return self.attach_source(pid, research.wikidata(key))
        if provider == "url":
            source, data, suffix = research.fetch_source(key)
            return self.attach_source(pid, source, data, suffix)
        raise ValueError("Choose Wikipedia, Wikidata, or a public URL.")

    def source_text(self, pid: str, sid: str, query: str = "") -> dict:
        profile = self.profile(pid)
        source = next((s for s in profile.get("sources", []) if s["id"] == sid), None)
        if source is None:
            raise ValueError("Source is not attached to this profile.")
        text = (self.root / source["text_path"]).read_text(encoding="utf-8")
        if not query:
            return {"source": source, "text": text}
        matches = []
        for match in re.finditer(re.escape(query), text, flags=re.IGNORECASE):
            position = match.start()
            matches.append({"character_offset": position, "excerpt": text[max(0, position - 180):match.end() + 300]})
            if len(matches) == 50:
                break
        return {"source": source, "query": query, "matches": matches}

    def draft_character(self, pid: str) -> dict:
        profile = self.profile(pid)
        texts = {s["id"]: (self.root / s["text_path"]).read_text(encoding="utf-8") for s in profile.get("sources", [])}
        logs = [{"recording_id": r["id"], "segment_id": s["id"], "text": s["text"], "style": s["style"]}
                for r in self.records() for s in r["segments"] if r["bindings"].get(s["speaker"]) == pid]
        result = research.draft_from_sources(profile, texts, logs)
        result["character"] = research.validate_character(result["character"], set(texts))
        return {"profile_id": pid, "base_revision": profile.get("revision", 0), **result}

    def import_audio(self, path: Path, name: str | None = None, origin: dict | None = None) -> dict:
        sr, data = audio.read_audio(path)
        rid = identifier("rec")
        directory = self.records_dir / rid
        directory.mkdir()
        try:
            suffix = path.suffix.lower()[:12] or ".audio"
            original = directory / ("original" + suffix)
            shutil.copy2(path, original)
            digest = hashlib.sha256()
            with original.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            np.save(directory / "decoded.npy", data, allow_pickle=False)
            audio.write_audio(directory / "playback.wav", sr, data)
            record = {"id": rid, "name": str(name or path.name)[:200], "created_at": now(), "revision": 0,
                      "sample_rate": sr, "channels": data.shape[1], "duration": round(len(data) / sr, 6),
                      "original_file": original.name, "original_sha256": digest.hexdigest(),
                      "waveform": audio.waveform(data), "segments": [], "bindings": {},
                      "exclusive_segments": [], "embeddings": {}, "transcription": None,
                      "analysis": None, "origin": origin,
                      "source_format": quality.source_format(path),
                      "audio_processing": dict(quality.DEFAULT_PROCESSING),
                      "quality": {"channels": [quality.inspect(data[:, c], sr) for c in range(data.shape[1])],
                                  "mono_mix": quality.inspect(audio.mono(data), sr)}}
            write_json(directory / "record.json", record)
            return record
        except Exception:
            shutil.rmtree(directory)
            raise

    def samples(self, rid: str) -> tuple[int, np.ndarray]:
        record = self.record(rid)
        data = np.load(self.record_path(rid) / "decoded.npy", mmap_mode="r", allow_pickle=False)
        return record["sample_rate"], data

    def save_audio_settings(self, rid: str, settings: dict, expected_revision: int | None = None) -> dict:
        with self.lock:
            record = self.record(rid)
            self._check_revision(record, expected_revision)
            record["audio_processing"] = quality.validate_processing(settings, record["duration"])
            return self._commit(record)

    @staticmethod
    def _condition(samples, sr, full_signal, record):
        settings = quality.validate_processing(record.get("audio_processing"), record["duration"])
        noise = None
        if settings["enabled"] and settings["denoise_db"]:
            noise = full_signal[round(settings["noise_start"] * sr):round(settings["noise_end"] * sr)]
        return quality.condition(samples, sr, settings, noise)

    def audio_quality(self, rid: str, start: float = 0, end: float | None = None, channel: int | None = None) -> dict:
        record = self.record(rid)
        sr, data = self.samples(rid)
        start = _finite(start, "Start")
        end = _finite(end if end is not None else min(60, record["duration"]), "End")
        if not 0 <= start < end <= len(data) / sr or end - start > 60:
            raise ValueError("Inspect a region of up to 60 seconds inside the recording.")
        if channel is not None and (isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel < data.shape[1]):
            raise ValueError("Channel is outside this recording.")
        x = audio.mono(data, channel)
        _, report = self._condition(x[round(start * sr):round(end * sr)], sr, x, record)
        return {"recording_id": rid, "start_seconds": start, "end_seconds": end, "channel": channel,
                "source_format": record.get("source_format", {}), **report}

    @staticmethod
    def _check_revision(current: dict, expected: int | None):
        if expected is not None and (isinstance(expected, bool) or not isinstance(expected, int)
                                     or current.get("revision", 0) != expected):
            raise ValueError("This item changed while it was being edited or processed. Reload its saved data before retrying.")

    def _commit(self, record: dict, revision: int | None = None, preserve_current: bool = False) -> dict:
        with self.lock:
            current = self.record(record["id"])
            self._check_revision(current, revision)
            if True:
                history = self.record_path(record["id"]) / "history"
                history.mkdir(exist_ok=True)
                write_json(history / f"revision_{current['revision']:08d}.json", current)
            record["revision"] = current["revision"] + 1
            write_json(self.record_path(record["id"]) / "record.json", record)
        return record

    def analyze(self, rid: str, method: str = "reference", count: int | None = None) -> dict:
        record = self.record(rid)
        revision = record["revision"]
        sr, data = self.samples(rid)
        if method == "pyannote":
            if count is not None and (isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 20):
                raise ValueError("Speaker count must be between 1 and 20, or automatic.")
            result = models.diarize(data, sr, int(count) if count else None)
        elif method in ("reference", "channels"):
            segments = []
            channels = range(data.shape[1]) if method == "channels" else [None]
            for index, channel in enumerate(channels):
                for start, end in audio.activity_regions(audio.mono(data, channel), sr):
                    segments.append({"start": start, "end": end, "speaker": f"VOICE_{index + 1:02d}",
                                     "channel": channel, "purity": "user_declared_single_voice" if method == "reference" else "unreviewed",
                                     "text": "", "style": "neutral"})
            result = {"segments": sorted(segments, key=lambda s: s["start"]), "exclusive_segments": [],
                      "embeddings": {}, "backend": "energy-activity-gate",
                      "note": "Activity detection does not identify people. Reference mode declares one voice; channel mode requires listening and review."}
        else:
            raise ValueError("Choose reference, channels, or pyannote processing.")
        record["segments"] = self.validate_segments(result["segments"], record)
        # Model speaker labels are arbitrary across runs, even when their strings match.
        record["bindings"] = {}
        record["exclusive_segments"] = result.get("exclusive_segments", [])
        record["embeddings"] = result.get("embeddings", {})
        record["embedding_model"] = result.get("embedding_model")
        record["analysis"] = {"method": method, "backend": result["backend"], "at": now(),
                              "note": result.get("note", "Overlapping speaker regions are excluded from clean references.")}
        record["transcription"] = None
        return self._commit(record, revision, preserve_current=True)

    def validate_segments(self, rows: list, record: dict) -> list[dict]:
        if not isinstance(rows, list) or len(rows) > 10000:
            raise ValueError("Supply a list of up to 10,000 regions.")
        result = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError("Each region must be an object.")
            start, end = _finite(row.get("start"), "Start"), _finite(row.get("end"), "End")
            if start < 0 or end <= start or end > record["duration"] + 0.001:
                raise ValueError(f"Region {index + 1} must fit inside the recording and have positive duration.")
            channel = row.get("channel")
            if channel is not None:
                if isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel < record["channels"]:
                    raise ValueError("Channel must be a valid zero-based channel number, or null for mix.")
            speaker = str(row.get("speaker", "")).strip()
            if not speaker or len(speaker) > 80:
                raise ValueError("Each region needs a speaker label of up to 80 characters.")
            purity = row.get("purity", "unreviewed")
            if purity not in ("unreviewed", "user_declared_single_voice", "model_nonoverlap", "reviewed_single_voice"):
                raise ValueError("Unknown reference review status.")
            segment_id = row.get("id")
            if not isinstance(segment_id, str) or not re.fullmatch(r"seg_[a-f0-9]{16}", segment_id):
                segment_id = identifier("seg")
            start, end = round(start, 6), round(min(end, record["duration"]), 6)
            if end <= start:
                raise ValueError("Region duration must remain positive at microsecond precision.")
            result.append({"id": segment_id, "start": start, "end": end,
                           "speaker": speaker, "channel": channel, "purity": purity,
                           "text": str(row.get("text", ""))[:10000], "style": str(row.get("style", "neutral"))[:80] or "neutral"})
        if len({s["id"] for s in result}) != len(result):
            raise ValueError("Region identifiers must be unique.")
        return sorted(result, key=lambda s: (s["start"], s["speaker"]))

    def save_segments(self, rid: str, rows: list, expected_revision: int | None = None) -> dict:
        with self.lock:
            record = self.record(rid)
            self._check_revision(record, expected_revision)
            revised = self.validate_segments(rows, record)
            signature = lambda values: [(s["start"], s["end"], s["speaker"], s["channel"]) for s in values]
            if signature(revised) != signature(record["segments"]):
                record["embeddings"] = {}
                record["embedding_model"] = None
            record["segments"] = revised
            labels = {s["speaker"] for s in revised}
            record["bindings"] = {s: p for s, p in record["bindings"].items() if s in labels}
            # Edited regions take precedence over model-specific exclusive assignment.
            record["exclusive_segments"] = []
            return self._commit(record)

    def bind(self, rid: str, speaker: str, profile_id: str | None, expected_revision: int | None = None) -> dict:
        with self.lock:
            record = self.record(rid)
            self._check_revision(record, expected_revision)
            if speaker not in {s["speaker"] for s in record["segments"]}:
                raise ValueError("Speaker label not found in this recording.")
            if profile_id and profile_id not in {p["id"] for p in self.profiles()}:
                raise ValueError("Voice profile not found.")
            if profile_id:
                record["bindings"][speaker] = profile_id
            else:
                record["bindings"].pop(speaker, None)
            return self._commit(record)

    def transcribe(self, rid: str, model: str = "small", language: str | None = None) -> dict:
        record = self.record(rid)
        revision = record["revision"]
        sr, data = self.samples(rid)
        record["transcription"] = models.transcribe(data, sr, model, language)
        return self._commit(record, revision)

    def separate(self, rid: str, start: float, end: float) -> list[dict]:
        sr, data = self.samples(rid)
        start, end = _finite(start, "Start"), _finite(end, "End")
        if not 0 <= start < end <= len(data) / sr or end - start > 30:
            raise ValueError("Choose an excerpt inside the recording, up to 30 seconds long.")
        target_sr, separated = models.separate(data[round(start * sr):round(end * sr)], sr, self.root / "models" / "sepformer")
        created = []
        with self.lock:
            temporary = self.root / (identifier("separation") + ".wav")
            try:
                for channel in range(2):
                    audio.write_audio(temporary, target_sr, separated[:, channel])
                    created.append(self.import_audio(temporary, f"Source {channel + 1} · {self.record(rid)['name']}",
                        {"recording_id": rid, "start_seconds": start, "end_seconds": end,
                         "source_index": channel, "method": "sepformer-wsj02mix", "identity_verified": False,
                         "note": "Anonymous estimated source. Listen before assigning a named voice; artifacts and source swaps are possible."}))
            finally:
                temporary.unlink(missing_ok=True)
        for record in created:
            self.save_audio_settings(record["id"], {**quality.DEFAULT_PROCESSING, "enabled": True, "remove_dc": False, "highpass_hz": 0})
        return [self.record(r["id"]) for r in created]

    def clean_regions(self, record: dict, segment: dict) -> list[tuple[float, float]]:
        if segment["purity"] == "unreviewed":
            return []
        blockers = []
        # Different physical channels are independently extracted; only common mixes conflict.
        for other in record["segments"]:
            same_signal = (segment["channel"] is None or other["channel"] is None
                           or segment["channel"] == other["channel"])
            if same_signal and other["speaker"] != segment["speaker"]:
                blockers.append((other["start"], other["end"]))
        return audio.subtract_regions(segment["start"], segment["end"], blockers)

    @staticmethod
    def transcript_rows(record: dict) -> list[dict]:
        annotation = record["segments"]
        exclusive = record.get("exclusive_segments") or annotation
        def assignment(start, end):
            intervals = {}
            for s in exclusive:
                a, b = max(start, s["start"]), min(end, s["end"])
                if a < b:
                    intervals.setdefault(s["speaker"], []).append((a, b))
            scores = {}
            for speaker, spans in intervals.items():
                total, previous = 0, start
                for a, b in sorted(spans):
                    total += max(0, b - max(a, previous))
                    previous = max(previous, b)
                scores[speaker] = total
            ranked = sorted(scores, key=lambda speaker: (-scores[speaker], speaker))
            if not ranked:
                return None, [], "unassigned"
            if len(ranked) > 1 and abs(scores[ranked[0]] - scores[ranked[1]]) < 0.001:
                return None, ranked, "ambiguous"
            return ranked[0], ranked, "timing_heuristic"
        if record.get("transcription"):
            rows = []
            for s in record["transcription"]["segments"]:
                units = s.get("words") or [{"start": s["start"], "end": s["end"], "word": s["text"], "probability": None}]
                for word in units:
                    speaker, candidates, method = assignment(word["start"], word["end"])
                    crossing = [r for r in annotation if r["start"] < word["end"] and r["end"] > word["start"]]
                    overlap = set()
                    for first in crossing:
                        for second in crossing:
                            if first["speaker"] != second["speaker"] and max(first["start"], second["start"], word["start"]) < min(first["end"], second["end"], word["end"]):
                                overlap.update([first["speaker"], second["speaker"]])
                    if overlap:
                        # Timing dominance is not evidence that an ASR word belongs
                        # to one of several simultaneous voices in the mono mix.
                        speaker, method = None, "ambiguous"
                        candidates = sorted(set(candidates) | overlap)
                    rows.append({**word, "speaker": speaker, "candidate_speakers": candidates,
                                 "overlap_speakers": sorted(overlap), "assignment": method,
                                 "profile_id": record["bindings"].get(speaker), "text": word["word"].strip()})
            return rows
        return [{"start": s["start"], "end": s["end"], "text": s["text"], "speaker": s["speaker"],
                 "profile_id": record["bindings"].get(s["speaker"]), "assignment": "manual", "probability": None}
                for s in annotation if s["text"].strip()]

    def export(self, profile_ids: list[str] | None = None, encoding: str = "FLOAT32", quality_policy: str = "high_fidelity") -> Path:
        """Export one immutable snapshot; original recordings stay local."""
        if encoding not in ("FLOAT32", "PCM24", "PCM16"):
            raise ValueError("Choose FLOAT32, PCM24, or PCM16 export encoding.")
        if quality_policy not in ("high_fidelity", "standard"):
            raise ValueError("Choose high_fidelity or standard quality screening.")
        with self.lock:
            records, profiles = self.records(), self.profiles()
        if profile_ids is not None:
            if not isinstance(profile_ids, list) or any(p not in {v["id"] for v in profiles} for p in profile_ids):
                raise ValueError("One or more requested profiles do not exist.")
            profiles = [p for p in profiles if p["id"] in profile_ids]
        if not profiles:
            raise ValueError("Create and assign at least one voice profile before exporting.")
        selected = {p["id"] for p in profiles}
        export_id = identifier("pack")
        directory = self.exports_dir / export_id
        directory.mkdir()
        clips_dir = directory / "clips"
        clips_dir.mkdir()
        manifest = {"schema_version": "1.1.0", "producer": "Voice Profile Studio", "producer_version": __version__,
                    "created_at": now(), "pack_id": export_id, "profiles": [], "recordings": [],
                    "audio_export": {"encoding": encoding, "quality_policy": quality_policy,
                                     "quality_report_path": "quality_report.json", "native_rate_preserved": True},
                    "limitations": ["Speaker IDs are recording-local; cross-file identity is explicitly assigned by the user.",
                                    "References retain background sound. Detection and separation can make mistakes.",
                                    "Expression requests describe input for a renderer; this package is not a trained voice-cloning model."]}
        refs_by_profile = {p["id"]: [] for p in profiles}
        embeddings_by_profile = {p["id"]: [] for p in profiles}
        transcript, segment_table, quality_reports = [], [], []
        for record in records:
            if not selected.intersection(record["bindings"].values()):
                continue
            sr, data = self.samples(record["id"])
            record_transcript = self.transcript_rows(record)
            covered_spans = {}
            exported_record = {key: record.get(key) for key in (
                "id", "name", "sample_rate", "channels", "duration", "original_sha256", "analysis", "origin", "revision",
                "source_format", "audio_processing", "quality")}
            exported_record["speaker_bindings"] = {s: p for s, p in record["bindings"].items() if p in selected}
            exported_record["segments"] = [s for s in record["segments"] if record["bindings"].get(s["speaker"]) in selected]
            exported_record["overlap_detection_available"] = False
            exported_record["transcription_status"] = "model" if record.get("transcription") else "manual_or_absent"
            exported_record["transcription_model"] = record["transcription"]["model"] if record.get("transcription") else None
            manifest["recordings"].append(exported_record)
            for speaker, vector in record.get("embeddings", {}).items():
                pid = record["bindings"].get(speaker)
                if pid in selected:
                    embeddings_by_profile[pid].append({"recording_id": record["id"], "speaker_label": speaker,
                                                      "model": record.get("embedding_model"), "vector": vector,
                                                      "use": "Compare only compatible model embeddings; calibrate thresholds on your data."})
            for segment in record["segments"]:
                pid = record["bindings"].get(segment["speaker"])
                if pid not in selected:
                    continue
                clean = self.clean_regions(record, segment)
                signal_key = (pid, segment["channel"] if record["channels"] > 1 else None)
                covered = covered_spans.setdefault(signal_key, [])
                clean = [piece for a, b in clean for piece in audio.subtract_regions(a, b, covered)]
                segment_table.append({"recording_id": record["id"], "profile_id": pid, **segment,
                                      "eligible_reference_seconds": round(sum(b - a for a, b in clean), 6)})
                x = audio.mono(data, segment["channel"])
                for piece_index, (start, end) in enumerate(clean):
                    # Reference chunks are capped at 20 seconds to suit most downstream conditioning inputs.
                    for chunk_index, chunk_start in enumerate(np.arange(start, end, 20.0)):
                        chunk_end = min(end, float(chunk_start) + 20.0)
                        if chunk_end - chunk_start < 0.12:
                            continue
                        samples = x[int(round(chunk_start * sr)):int(round(chunk_end * sr))].copy()
                        if not len(samples):
                            continue
                        samples, processing = self._condition(samples, sr, x, record)
                        source_errors = [i for i in processing["source_quality"]["issues"]
                                         if i["code"] in ("clipping", "no_useful_signal")]
                        output_errors = [i for i in processing["output_quality"]["issues"] if i["severity"] == "error"]
                        rejected = source_errors + output_errors
                        if quality_policy == "high_fidelity" and sr < 22050:
                            rejected.append({"code": "limited_bandwidth", "severity": "error",
                                             "message": "High-fidelity screening requires a source rate of at least 22.05 kHz. Use standard screening for reviewed low-bandwidth references."})
                        report = {"recording_id": record["id"], "segment_id": segment["id"], "profile_id": pid,
                                  "source_start_seconds": round(float(chunk_start), 6), "source_end_seconds": round(chunk_end, 6),
                                  "channel": segment["channel"], "included": not bool(rejected), "exclusion_reasons": rejected, **processing}
                        quality_reports.append(report)
                        if rejected:
                            continue
                        relative = f"clips/{record['id']}_{segment['id']}_{piece_index}_{chunk_index}.wav"
                        audio.write_audio(directory / relative, sr, samples, encoding)
                        # Report the delivered WAV, including quantization/dither, rather than its input.
                        delivered_sr, delivered = audio.read_audio(directory / relative)
                        processing["output_quality"] = quality.inspect(delivered, delivered_sr)
                        report["output_quality"] = processing["output_quality"]
                        encoded_errors = [issue for issue in processing["output_quality"]["issues"] if issue["severity"] == "error"]
                        if encoded_errors:
                            report["included"] = False
                            report["exclusion_reasons"] = encoded_errors
                            (directory / relative).unlink()
                            continue
                        report["path"] = relative
                        covered.append((float(chunk_start), chunk_end))
                        # Text is retained only when a clip covers the entire manually labelled region.
                        full_region = abs(chunk_start - segment["start"]) < 0.001 and abs(chunk_end - segment["end"]) < 0.001
                        clip_words = [word for word in record_transcript
                                      if word.get("assignment") != "manual" and word.get("profile_id") == pid
                                      and word["start"] >= chunk_start and word["end"] <= chunk_end]
                        text = segment["text"] if full_region else ""
                        alignment = "whole_manual_region" if text else "absent"
                        if not text and clip_words:
                            text = "".join(word.get("word", " " + word["text"]) for word in clip_words).strip()
                            alignment = "asr_word_timestamps"
                        ref = {"id": identifier("ref"), "path": relative, "recording_id": record["id"],
                               "sha256": hashlib.sha256((directory / relative).read_bytes()).hexdigest(),
                               "segment_id": segment["id"], "source_start_seconds": round(float(chunk_start), 6),
                               "source_end_seconds": round(chunk_end, 6), "channel": segment["channel"],
                               "duration_seconds": round(len(samples) / sr, 6), "sample_rate_hz": sr,
                               "encoding": {"FLOAT32": "FLOAT_32", "PCM24": "PCM_24", "PCM16": "PCM_16"}[encoding],
                               "style": segment["style"], "review_status": segment["purity"],
                               "text": text, "text_alignment": alignment,
                               "measurements": audio.acoustics(delivered, delivered_sr),
                               "spectrum": spectrum.measure(delivered, delivered_sr),
                               "quality": processing["output_quality"], "processing": processing,
                               "source_sample_start": round(chunk_start * sr), "source_sample_end": round(chunk_end * sr)}
                        refs_by_profile[pid].append(ref)
            for row in record_transcript:
                if row.get("profile_id") in selected or row.get("speaker") is None:
                    transcript.append({"recording_id": record["id"], **row})
        for profile in profiles:
            refs = refs_by_profile[profile["id"]]
            measures = {}
            for metric in ("pitch_hz", "spectral_centroid_hz", "frame_energy_dbfs", "voicing_periodicity"):
                measures[metric] = audio.summarize([r["measurements"][metric]["median"] for r in refs
                                                   if r["measurements"][metric]["median"] is not None])
            bound = any(profile["id"] in r["bindings"].values() for r in records)
            styles = sorted({r["style"] for r in refs})
            character_dir = directory / "characters" / profile["id"]
            character_dir.mkdir(parents=True)
            character = research.validate_character(profile.get("character") or research.character_defaults(),
                                                    {source["id"] for source in profile.get("sources", [])})
            profile["character"] = character
            write_json(character_dir / "character.json", character)
            (character_dir / "prompt.txt").write_text(research.character_prompt(profile), encoding="utf-8")
            logs = [{"recording_id": r["recording_id"], "segment_id": r["id"], "start": r["start"], "end": r["end"],
                     "speaker": r["speaker"], "text": r["text"], "style": r["style"], "text_origin": "manual_annotation",
                     "reference_ids": [ref["id"] for ref in refs if ref["segment_id"] == r["id"]]}
                    for r in segment_table if r["profile_id"] == profile["id"]]
            logs.extend({**r, "text_origin": "transcription", "reference_ids": [ref["id"] for ref in refs
                         if ref["recording_id"] == r["recording_id"] and r["start"] >= ref["source_start_seconds"]
                         and r["end"] <= ref["source_end_seconds"]]}
                        for r in transcript if r.get("profile_id") == profile["id"] and r.get("assignment") != "manual")
            with (character_dir / "voice_logs.jsonl").open("w", encoding="utf-8") as stream:
                for log in logs:
                    stream.write(json.dumps(log, ensure_ascii=False, allow_nan=False) + "\n")
            for source in profile.get("sources", []):
                source_dir = self.root / "sources" / source["id"]
                shutil.copytree(source_dir, directory / "sources" / source["id"], dirs_exist_ok=True)
            manifest["profiles"].append({**profile, "references": refs, "embeddings": embeddings_by_profile[profile["id"]],
                "reference_seconds": round(sum(r["duration_seconds"] for r in refs), 6),
                "reference_count": len(refs), "aggregate_measurements": measures,
                "excluded_reference_count": sum(not q["included"] for q in quality_reports if q["profile_id"] == profile["id"]),
                "aggregate_method": "distribution of per-clip medians; not a pooled frame distribution",
                "status": "ready_for_review" if refs else "no_clean_references" if bound else "unassigned",
                "character_context": {"path": f"characters/{profile['id']}/character.json",
                                      "prompt_path": f"characters/{profile['id']}/prompt.txt",
                                      "voice_logs_path": f"characters/{profile['id']}/voice_logs.jsonl",
                                      "completeness": {"biography_present": bool(character["biography"].strip()),
                                                       "demographic_field_count": len(character["demographics"]),
                                                       "statistic_field_count": len(character["statistics"]),
                                                       "source_count": len(profile.get("sources", [])),
                                                       "voice_log_count": len(logs), "audio_reference_count": len(refs)},
                                      "provenance": "Authored canon and field_sources are separate from unreviewed retrieved claims."},
                "expression": {"available_styles": styles, "style_origin": "user labels; not inferred emotions",
                               "reference_selection": "prefer signal checks, source bandwidth, requested style, and 3-12 seconds",
                               "renderer": "Bundled local F5-TTS / Vocos", "generated_speech": any(json.loads(p.read_text()).get("generation_performed") and json.loads(p.read_text()).get("profile_id")==profile["id"] for p in (self.root/"generations").glob("gen_*/audit.json"))},
                "transcription": {"language_hint": profile["language"] or None,
                                  "word_timestamps_file": "transcript.jsonl", "speaker_assignment": "timeline overlap heuristic; review uncertain assignments"}})
        manifest["voice_analysis_policy"] = {"tone_and_inflection": "circumstance_dependent", "spectrum_separate_from_pitch": True, "spectral_agreement_verified": False}
        manifest["generation_audits"] = []
        for generation in (self.root / "generations").glob("gen_*/audit.json"):
            result = json.loads(generation.read_text(encoding="utf-8"))
            if result.get("profile_id") in selected:
                shutil.copytree(generation.parent, directory / "generations" / generation.parent.name)
                manifest["generation_audits"].append("generations/" + generation.parent.name + "/audit.json")
        for pid in selected:
            history = self.root / "profile_history" / pid
            if history.exists(): shutil.copytree(history, directory / "profile_history" / pid)
        for record in manifest["recordings"]:
            history = self.record_path(record["id"]) / "history"
            if history.exists(): shutil.copytree(history, directory / "record_history" / record["id"])
        write_json(directory / "manifest.json", manifest)
        write_json(directory / "quality_report.json", {"quality_policy": quality_policy, "encoding": encoding,
                   "included_count": sum(q["included"] for q in quality_reports),
                   "excluded_count": sum(not q["included"] for q in quality_reports), "clips": quality_reports,
                   "note": "Signal checks do not guarantee perceptual quality or speaker purity. Listen to the exported references."})
        with (directory / "transcript.jsonl").open("w", encoding="utf-8") as stream:
            for row in transcript:
                stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False) + "\n")
        keys = ["recording_id", "profile_id", "id", "start", "end", "speaker", "channel", "purity", "style", "text", "eligible_reference_seconds"]
        with (directory / "segments.csv").open("w", newline="", encoding="utf-8-sig") as stream:
            writer = csv.DictWriter(stream, fieldnames=keys, extrasaction="ignore")
            writer.writeheader()
            # Preserve literal content in JSON; CSV cells must not become spreadsheet formulas.
            writer.writerows({key: "'" + value if isinstance(value, str) and
                              (value.lstrip().startswith(("=", "+", "-", "@")) or value.startswith(("\t", "\r")))
                              else value for key, value in row.items()} for row in segment_table)
        for record in manifest["recordings"]:
            rows = [r for r in transcript if r["recording_id"] == record["id"]]
            rows.sort(key=lambda r: r["start"])
            srt, vtt = [], ["WEBVTT", ""]
            for index, row in enumerate(rows, 1):
                label = row.get("speaker") or "UNASSIGNED"
                text = f"[{label}] {row['text']}".replace("\n", " ")
                srt.extend([str(index), f"{timestamp(row['start'])} --> {timestamp(row['end'])}", text, ""])
                vtt.extend([str(index), f"{timestamp(row['start'], False)} --> {timestamp(row['end'], False)}", text, ""])
            (directory / f"{record['id']}.srt").write_text("\n".join(srt), encoding="utf-8")
            (directory / f"{record['id']}.vtt").write_text("\n".join(vtt), encoding="utf-8")
        (directory / "README.txt").write_text(
            "VOICE REFERENCE PACK\n\nOpen manifest.json first. All clip paths are relative to this folder.\n"
            f"clips/: native sample rate, mono {encoding} snippets with source timestamps and review status.\n"
            "quality_report.json: source/output checks, applied processing, and excluded clips with reasons.\n"
            "Original files are retained in the local application, not included in this export.\n"
            "transcript.jsonl: source-time word/region records; absent ASR means no invented transcript.\n"
            "segments.csv: editable annotations and eligible reference durations.\n"
            "SRT/VTT files use source recording timestamps. Clips are separate; these times are not clip offsets.\n"
            "No emotion, accent, gender, medical traits, or cross-file identity is inferred.\n"
            "Generation is performed by the bundled F5-TTS adapter. Listening review remains separate.\n",
            encoding="utf-8")
        archive = directory.with_suffix(".zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(directory.rglob("*")):
                if path.is_file():
                    bundle.write(path, path.relative_to(directory))
        return archive

    def preview(self, rid: str, start: float, end: float, channel: int | None = None, processed: bool = False) -> bytes:
        start, end = _finite(start, "Start"), _finite(end, "End")
        sr, data = self.samples(rid)
        if not 0 <= start < end <= len(data) / sr or end - start > 60:
            raise ValueError("Preview a region of up to 60 seconds inside the recording.")
        if channel is not None and (isinstance(channel, bool) or not isinstance(channel, int) or not 0 <= channel < data.shape[1]):
            raise ValueError("Channel is outside this recording.")
        full = audio.mono(data, channel)
        x = full[round(start * sr):round(end * sr)]
        if not len(x):
            raise ValueError("Choose a preview containing at least one sample.")
        if processed:
            x, _ = self._condition(x, sr, full, self.record(rid))
        stream = io.BytesIO()
        audio.write_audio(stream, sr, x)
        return stream.getvalue()

    def demo(self) -> list[dict]:
        """Synthetic tones exercise channel extraction, not speech-model accuracy."""
        sr = 24000
        t = np.arange(sr * 9) / sr
        left = np.zeros(len(t), dtype=np.float32)
        right = left.copy()
        for target, freq, ranges in [(left, 180, [(0.5, 2.5), (4, 6)]), (right, 270, [(2, 4), (6.5, 8.5)])]:
            for a, b in ranges:
                mask = (t >= a) & (t < b)
                local = t[mask] - a
                envelope = np.minimum(1, local / 0.05) * np.minimum(1, (b - a - local) / 0.05)
                target[mask] = (0.18 * (np.sin(2 * np.pi * freq * local) + 0.3 * np.sin(4 * np.pi * freq * local)) * envelope).astype(np.float32)
        path = self.root / "synthetic_demo.wav"
        try:
            audio.write_audio(path, sr, np.stack([left, right], axis=1))
            record = self.import_audio(path, "Demo · two synthetic channels (not speech)", {"type": "synthetic_test_fixture"})
        finally:
            path.unlink(missing_ok=True)
        record = self.analyze(record["id"], "channels")
        rows = record["segments"]
        for segment in rows:
            segment["purity"] = "reviewed_single_voice"
        self.save_segments(record["id"], rows)
        for speaker, name in [("VOICE_01", "Demo · 180 Hz"), ("VOICE_02", "Demo · 270 Hz")]:
            profile = self.new_profile(name, "Synthetic test tone, not a human voice.")
            self.bind(record["id"], speaker, profile["id"])
        return [self.record(record["id"])]
