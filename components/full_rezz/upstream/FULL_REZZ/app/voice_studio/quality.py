"""Native-rate quality screening and reversible reference conditioning.

These are signal checks, not a speech/identity or perceptual-quality model.
Noise estimates require a user-selected noise-only interval for denoising.
"""
from __future__ import annotations

import math
import struct
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter

DEFAULT_PROCESSING = {"enabled": False, "remove_dc": True, "highpass_hz": 30.0,
                      "peak_dbfs": -3.0, "fade_ms": 5.0, "denoise_db": 0.0,
                      "noise_start": None, "noise_end": None}


def validate_processing(value: dict | None, duration: float) -> dict:
    if value is None:
        return dict(DEFAULT_PROCESSING)
    if not isinstance(value, dict) or set(value) - set(DEFAULT_PROCESSING):
        raise ValueError("Supply supported audio cleanup settings.")
    result = {**DEFAULT_PROCESSING, **value}
    for key in ("enabled", "remove_dc"):
        if not isinstance(result[key], bool):
            raise ValueError(f"{key} must be true or false.")
    for key, low, high in [("highpass_hz", 0, 120), ("peak_dbfs", -18, -1),
                           ("fade_ms", 0, 20), ("denoise_db", 0, 12)]:
        if isinstance(result[key], bool):
            raise ValueError(f"{key} must be a number, not a boolean.")
        try:
            number = float(result[key])
        except (ValueError, TypeError) as exc:
            raise ValueError(f"{key} must be a number.") from exc
        if not math.isfinite(number) or not low <= number <= high:
            raise ValueError(f"{key} must be between {low} and {high}.")
        result[key] = number
    if result["denoise_db"] > 0:
        if isinstance(result["noise_start"], bool) or isinstance(result["noise_end"], bool):
            raise ValueError("Noise interval times must be numbers, not booleans.")
        try:
            start, end = float(result["noise_start"]), float(result["noise_end"])
        except (TypeError, ValueError) as exc:
            raise ValueError("Noise reduction needs a noise-only start and end time.") from exc
        if not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= duration
                and 0.1 <= end - start <= 5):
            raise ValueError("Choose a noise-only interval of 0.1–5 seconds inside this recording.")
        result["noise_start"], result["noise_end"] = start, end
    else:
        result["noise_start"], result["noise_end"] = None, None
    return result


def db(value: float) -> float:
    return round(20 * math.log10(max(float(value), 1e-10)), 4)


def inspect(data: np.ndarray, sr: int) -> dict:
    """Screen the native signal; quiet-frame SNR is only a heuristic.

    A constant recording cannot establish its noise floor. Do not mistake
    voiced periodicity or low energy for proof that background noise is absent.
    """
    x = np.asarray(data, dtype=np.float64).reshape(-1)
    if not len(x) or not np.isfinite(x).all():
        raise ValueError("Quality analysis requires finite, nonempty samples.")
    peak = float(np.max(np.abs(x)))
    rms = float(np.sqrt(np.mean(x ** 2)))
    centered = x - x.mean()
    ac_rms = float(np.sqrt(np.mean(centered ** 2)))
    frame = max(1, round(sr * 0.02))
    count = len(x) // frame
    levels = np.sqrt(np.mean(x[:count * frame].reshape(-1, frame) ** 2, axis=1)) if count else np.array([rms])
    floor, loud = float(np.percentile(levels, 10)), float(np.percentile(levels, 90))
    quiet_available = bool(len(levels) >= 10 and floor < loud * 0.45 and loud > 1e-5)
    snr = db(loud / max(floor, 1e-10)) if quiet_available else None
    over = float(np.mean(np.abs(x) > 1.0))
    # Consecutive near-full-scale samples are stronger evidence than one loud peak.
    # Float WAV/model estimates can exceed 1 without losing their samples.
    # Only runs at the digital full-scale boundary indicate saturation here;
    # over-range values remain a separate error that headroom cleanup can fix.
    magnitude = np.abs(x)
    near = (magnitude >= (1 - 1 / 32768)) & (magnitude <= 1)
    adjacent = near[:-1] & near[1:] & (np.signbit(x[:-1]) == np.signbit(x[1:]))
    clipping = float(np.mean(near))
    issues = []
    def issue(code, severity, message):
        issues.append({"code": code, "severity": severity, "message": message})
    if over:
        issue("over_range", "error", "Samples exceed digital full scale; playback/integer conversion can distort. Enable headroom cleanup.")
    if ac_rms < 1e-5:
        issue("no_useful_signal", "error", "The selected signal is silent or has only a DC level.")
    elif rms < 0.001:
        issue("very_quiet", "warning", "Very low level. Raising gain also raises background noise.")
    if len(adjacent) and np.mean(adjacent) > 0.0001:
        issue("clipping", "error", "Repeated full-scale samples suggest clipping. Lowering export gain cannot repair source distortion.")
    elif clipping > 0:
        issue("full_scale_peak", "warning", "The signal reaches full scale. Listen for distortion.")
    if abs(float(x.mean())) > 0.01:
        issue("dc_offset", "warning", "A measurable DC offset is present; DC removal is available.")
    if sr < 22050:
        issue("limited_bandwidth", "warning", "This source has limited bandwidth. Upsampling does not restore missing detail.")
    if quiet_available and snr < 20:
        issue("background_noise", "warning", "Quiet-frame contrast is low. Listen for noise and select a noise-only interval if needed.")
    if abs(float(x[0])) > 0.02 or abs(float(x[-1])) > 0.02:
        issue("abrupt_boundary", "warning", "A nonzero clip boundary can click. Short boundary fades are available.")
    return {"sample_rate_hz": sr, "duration_seconds": round(len(x) / sr, 6),
            "peak_dbfs": db(peak), "rms_dbfs": db(rms), "dc_offset": round(float(x.mean()), 8),
            "near_full_scale_fraction": round(clipping, 8), "over_range_fraction": round(over, 8),
            "quiet_frame_noise_dbfs": db(floor) if quiet_available else None,
            "estimated_snr_db": snr, "noise_estimate_available": quiet_available,
            "status": "reject" if any(i["severity"] == "error" for i in issues) else "review" if issues else "signal_checks_passed",
            "issues": issues, "listening_review_required": True,
            "method": "Native-rate levels, DC, clipping runs, 20ms energy contrast, and crop boundaries.",
            "limitations": ["Energy contrast is not a calibrated speech/noise SNR measurement.",
                            "Checks cannot prove speaker purity, absence of bleed, or perceptual fidelity.",
                            "Clipping, lossy encoding, and low source bandwidth cannot be repaired by format conversion."]}


def source_format(path: Path) -> dict:
    """Read container metadata without deriving bit depth from decoded floats."""
    result = {"container": path.suffix.lower().lstrip('.'), "codec": None, "bits_per_sample": None,
              "working_format": "float32", "original_file_preserved": True}
    if path.suffix.lower() == '.wav':
        with path.open('rb') as stream:
            header = stream.read(12)
            if header[:4] == b'RIFF' and header[8:] == b'WAVE':
                # WAV can contain metadata before fmt/data. Bound metadata traversal.
                for _ in range(100):
                    chunk = stream.read(8)
                    if len(chunk) < 8:
                        break
                    tag, size = chunk[:4], struct.unpack('<I', chunk[4:])[0]
                    if tag == b'fmt ':
                        fmt = stream.read(min(size, 40))
                        if len(fmt) >= 16:
                            code, _, _, _, _, bits = struct.unpack('<HHIIHH', fmt[:16])
                            if code == 0xfffe and len(fmt) >= 40:
                                code = struct.unpack('<H', fmt[24:26])[0]
                            result.update(codec="IEEE_FLOAT" if code == 3 else "PCM" if code == 1 else str(code), bits_per_sample=bits)
                        break
                    stream.seek(size + size % 2, 1)
    if result['codec'] is None:
        try:
            import av
            with av.open(str(path)) as container:
                stream = container.streams.audio[0]
                result['codec'] = stream.codec_context.name
                result['bits_per_sample'] = getattr(stream.codec_context, 'bits_per_raw_sample', None) or None
        except (ImportError, OSError, ValueError, IndexError):
            pass
    return result


def _denoise(x: np.ndarray, noise: np.ndarray, sr: int, maximum_db: float) -> np.ndarray:
    size = min(2048, max(128, 2 ** math.ceil(math.log2(sr * 0.032))))
    size = min(size, len(x), len(noise))
    if size < 16:
        raise ValueError("The signal or noise sample is too short for noise reduction.")
    hop = max(1, size // 4)
    _, _, spectrum = signal.stft(x, fs=sr, nperseg=size, noverlap=size-hop, boundary='zeros', padded=True)
    _, _, noise_spectrum = signal.stft(noise, fs=sr, nperseg=size, noverlap=size-hop, boundary=None)
    noise_power = np.mean(np.abs(noise_spectrum) ** 2, axis=1, keepdims=True)
    power = np.abs(spectrum) ** 2
    gain = np.sqrt(np.maximum(1 - noise_power / np.maximum(power, 1e-20), 0))
    gain = uniform_filter(gain, size=(3, 5), mode='nearest')
    gain = np.maximum(gain, 10 ** (-maximum_db / 20))
    _, restored = signal.istft(spectrum * gain, fs=sr, nperseg=size, noverlap=size-hop, boundary=True)
    return restored[:len(x)]


def condition(data: np.ndarray, sr: int, settings: dict, noise: np.ndarray | None = None) -> tuple[np.ndarray, dict]:
    """Operate on a copy at the native rate; preserve exact samples when disabled."""
    original = np.asarray(data, dtype=np.float32)
    x = original.astype(np.float64, copy=True)
    steps = []
    gain_db = 0.0
    if settings['enabled']:
        if settings['remove_dc']:
            x -= x.mean()
            steps.append('remove_dc')
        if settings['highpass_hz']:
            sos = signal.butter(2, settings['highpass_hz'], btype='highpass', fs=sr, output='sos')
            if len(x) > 12:
                x = signal.sosfiltfilt(sos, x)
                steps.append('highpass')
        if settings['denoise_db']:
            if noise is None:
                raise ValueError("Noise reduction requires the selected noise-only samples.")
            n = np.asarray(noise, dtype=np.float64).copy()
            if settings['remove_dc']:
                n -= n.mean()
            if settings['highpass_hz'] and len(n) > 12:
                n = signal.sosfiltfilt(sos, n)
            x = _denoise(x, n, sr, settings['denoise_db'])
            steps.append('noise_profile_attenuation')
        fade = min(round(sr * settings['fade_ms'] / 1000), len(x) // 2)
        if fade > 1:
            envelope = np.sin(np.linspace(0, np.pi / 2, fade)) ** 2
            x[:fade] *= envelope
            x[-fade:] *= envelope[::-1]
            steps.append('boundary_fades')
        peak = float(np.max(np.abs(x)))
        if peak > 1e-8:
            target = 10 ** (settings['peak_dbfs'] / 20)
            # Cap amplification at 12dB: do not turn silence/noise into a loud reference.
            gain = min(target / peak, 10 ** (12 / 20))
            x *= gain
            gain_db = db(gain)
            steps.append('peak_headroom')
    result = x.astype(np.float32) if settings['enabled'] else original.copy()
    return result, {"enabled": settings['enabled'], "steps": steps, "gain_db": gain_db,
                    "settings": settings, "sample_rate_changed": False,
                    "sample_count_changed": False, "source_quality": inspect(original, sr),
                    "output_quality": inspect(result, sr)}
