"""Exact source exposure timing, independent of delivery frame rate."""
from fractions import Fraction
import math


def _integer(value, low, high, name):
    if type(value) is not int or not low <= value <= high:
        raise ValueError(f"Invalid {name}.")
    return value


def finite(value, low, high, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError(f"Invalid {name}.")
    return value


class ExposureClock:
    """Half-open exposure ranges. Keys take precedence over held procedural samples."""
    def __init__(self, config, fps=60):
        self.fps = _integer(fps, 60, 240, "output fps")
        if config.get("schema_version") != "1.0.0":
            raise ValueError("Unsupported render configuration.")
        source = config["source_fps"]
        self.rate = Fraction(_integer(source["numerator"], 1, 240000, "source numerator"),
                             _integer(source["denominator"], 1, 10000, "source denominator"))
        if not 1 <= self.rate <= 120:
            raise ValueError("Source fps must be 1–120.")
        self.duration = Fraction(str(finite(config["duration_seconds"], .001, 600, "duration")))
        count = self.duration * fps
        if count.denominator != 1:
            raise ValueError("Duration must fill an integer number of output frames.")
        self.frames = int(count)
        self.keys = config["keys"]
        if not isinstance(self.keys, list) or not self.keys or len(self.keys) > 10000:
            raise ValueError("A bounded authored key list is required.")
        last = -1
        for key in self.keys:
            frame = _integer(key["source_frame"], 0, 72000, "source key")
            if frame <= last or Fraction(frame, 1) / self.rate >= self.duration:
                raise ValueError("Source keys must be ordered, unique and inside the shot.")
            if not isinstance(key["pose_id"], str) or not key["pose_id"]:
                raise ValueError("A key requires an authored pose ID.")
            last = frame
        if self.keys[0]["source_frame"] != 0:
            raise ValueError("Declare a pose at frame zero.")
        self.ranges = config["exposures"]
        if not isinstance(self.ranges, list) or not self.ranges or len(self.ranges) > 10000:
            raise ValueError("A bounded exposure list is required.")
        end = 0
        for item in self.ranges:
            start = _integer(item["start_source_frame"], 0, 72000, "range start")
            next_end = _integer(item["end_source_frame"], 1, 72000, "range end")
            _integer(item["hold"], 1, 3, "exposure hold")
            if start != end or next_end <= start:
                raise ValueError("Exposure ranges must cover the shot without gaps or overlaps.")
            end = next_end
        if Fraction(end, 1) / self.rate < self.duration:
            raise ValueError("Exposure ranges must reach the end of the shot.")

    def at(self, index):
        _integer(index, 0, self.frames - 1, "frame index")
        source = Fraction(index, self.fps) * self.rate
        source_frame = source.numerator // source.denominator
        region = next(r for r in self.ranges if r["start_source_frame"] <= source_frame < r["end_source_frame"])
        key = self.keys[0]
        for candidate in self.keys[1:]:
            if candidate["source_frame"] > source_frame:
                break
            key = candidate
        sampled = region["start_source_frame"] + (source_frame - region["start_source_frame"]) // region["hold"] * region["hold"]
        sampled = max(key["source_frame"], sampled)
        return {"index": index, "source_frame": source_frame, "sample_source_frame": sampled,
                "body_time": float(Fraction(sampled, 1) / self.rate), "pose_id": key["pose_id"],
                "key_source_frame": key["source_frame"], "hold": region["hold"], "label": key.get("label", "")}

    def output_key(self, key):
        time = Fraction(key["source_frame"], 1) / self.rate
        frame = -(-time.numerator * self.fps // time.denominator)
        return {"frame": frame, "time_seconds": frame / self.fps, "authored_time_seconds": float(time),
                "source_frame": key["source_frame"], "pose_id": key["pose_id"], "label": key.get("label", "")}

