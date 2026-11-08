"""Local project validation. Asset hashes are byte evidence, not identity evidence."""
import hashlib
import json
from pathlib import Path, PurePosixPath
import wave
from .timing import ExposureClock, finite


def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_json(path):
    if Path(path).stat().st_size > 8 * 1024 * 1024:
        raise ValueError("JSON exceeds the 8 MiB limit.")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate JSON key.")
            result[key] = value
        return result
    def invalid(value):
        raise ValueError(f"Non-finite JSON number: {value}")
    return json.loads(Path(path).read_text(encoding="utf-8"), object_pairs_hook=pairs, parse_constant=invalid)


def local_file(root, relative):
    if not isinstance(relative, str) or "\\" in relative or ":" in relative or "\x00" in relative:
        raise ValueError("Invalid portable asset path.")
    p = PurePosixPath(relative)
    if p.is_absolute() or str(p) != relative or any(x in ("", ".", "..") for x in p.parts):
        raise ValueError("Asset path must be normalized and relative.")
    current = Path(root)
    for part in p.parts:
        current /= part
        if current.is_symlink():
            raise ValueError("Symlink assets are unsupported.")
    if not current.is_file() or not current.resolve().is_relative_to(Path(root).resolve()):
        raise ValueError("Missing or external project asset.")
    return current


class Project:
    def __init__(self, root, preset="production", fps=60):
        self.root = Path(root).resolve()
        self.config = read_json(local_file(self.root, "render_config.json"))
        self.model = read_json(local_file(self.root, "pose_model.json"))
        self.clock = ExposureClock(self.config, fps)
        if self.clock.frames > 4096:
            raise ValueError("Split long performances into clips of at most 4096 delivery frames.")
        if self.config.get("canvas") != [1280, 720]:
            raise ValueError("This authored rig uses a 1280 × 720 design canvas.")
        self.preset_name = preset
        self.preset = self.config["presets"][preset]
        for key, low, high in [("width", 320, 3840), ("height", 180, 2160), ("supersampling", 1, 2), ("crf", 0, 30)]:
            value = self.preset[key]
            if type(value) is not int or not low <= value <= high:
                raise ValueError(f"Invalid preset {key}.")
        if self.preset["width"] * 9 != self.preset["height"] * 16 or self.preset["width"] % 2 or self.preset["height"] % 2:
            raise ValueError("Preset requires even 16:9 dimensions.")
        finite(self.config["camera"]["push_fraction"], 0, .05, "camera push")
        pivot = self.config["camera"]["pivot"]
        if not isinstance(pivot, list) or len(pivot) != 2:
            raise ValueError("Invalid camera pivot.")
        for v, upper in zip(pivot, [1280, 720]):
            finite(v, 0, upper, "camera pivot")
        lighting = self.config["lighting"]
        if type(lighting["enabled"]) is not bool:
            raise ValueError("Lighting switch must be boolean.")
        for name in ["warm_rgb", "cool_rgb"]:
            values = lighting[name]
            if not isinstance(values, list) or len(values) != 3 or any(type(v) is not int or not 0 <= v <= 255 for v in values):
                raise ValueError("Invalid lighting color.")
        for name in ["warm_strength", "cool_strength"]:
            finite(lighting[name], 0, .3, name)
        finite(lighting["edge_width_source_pixels"], .5, 3, "edge width")
        thresholds = self.config["audit"]
        for name, low, high in [("minimum_triangle_area_ratio", .4, .7), ("maximum_arm_offset_source_pixels", 1, 45),
                               ("maximum_contact_drift_design_pixels", .1, 3), ("minimum_full_frame_psnr_db", 30, 50),
                               ("minimum_audio_correlation", .99, 1), ("minimum_audio_snr_db", 25, 60),
                               ("pose_jump_review_design_pixels", 1, 100), ("silhouette_jump_review_fraction", .01, .3)]:
            finite(thresholds[name], low, high, name)
        self.poses = {}
        assets = ["render_config.json", "pose_model.json", "assets/background.png", "assets/statement.original.wav",
                  "assets/fonts/DejaVuSans.ttf", "assets/fonts/DejaVuSans-Bold.ttf"]
        poses = self.model["poses"]
        if not isinstance(poses, list) or not 1 <= len(poses) <= 100:
            raise ValueError("Invalid authored pose count.")
        for pose in poses:
            if pose["id"] in self.poses:
                raise ValueError("Duplicate pose ID.")
            for name, length in [("hand", 2), ("mouth", 4)]:
                values = pose[name]
                if not isinstance(values, list) or len(values) != length:
                    raise ValueError("Invalid rig landmark.")
                for value in values:
                    finite(value, 0, 544, name)
            if len(pose["eyes"]) != 2 or len(pose["registered_contacts"]) != 2:
                raise ValueError("Two eyes and two contacts are required.")
            for row in pose["eyes"] + pose["registered_contacts"]:
                for value in row:
                    finite(value, 0, 544, "landmark")
            if any(len(x) != 4 for x in pose["eyes"]) or any(len(x) != 2 for x in pose["registered_contacts"]):
                raise ValueError("Invalid landmark dimensions.")
            if any(x[2] <= 0 or x[3] <= 0 for x in [pose["mouth"], *pose["eyes"]]):
                raise ValueError("Masks need positive radii.")
            self.poses[pose["id"]] = pose
            assets += [pose["base"], pose["face"]]
        if any(k["pose_id"] not in self.poses for k in self.clock.keys):
            raise ValueError("Timeline references an unavailable drawing.")
        self.assets = {name: digest(local_file(self.root, name)) for name in assets}
        source = local_file(self.root, "assets/statement.original.wav")
        with wave.open(str(source)) as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, 24000):
                raise ValueError("Speech requires mono PCM16 at 24 kHz.")
            self.speech_samples = audio.getnframes()
            if not 1 <= self.speech_samples <= 24000 * 600:
                raise ValueError("Invalid speech length.")
            self.speech = audio.readframes(self.speech_samples)
        self.offset = finite(self.config["voice_offset_seconds"], 0, float(self.clock.duration), "speech offset")
        if abs(self.offset * 24000 - round(self.offset * 24000)) > 1e-8:
            raise ValueError("Speech offset must lie on the audio sample grid.")
        if self.offset + self.speech_samples / 24000 > float(self.clock.duration):
            raise ValueError("Speech would exceed the shot duration.")

    def verify_unchanged(self):
        for name, expected in self.assets.items():
            if digest(local_file(self.root, name)) != expected:
                raise ValueError(f"Project asset changed during processing: {name}")
