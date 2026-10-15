"""Audio I/O and reproducible acoustic measurements; no identity inference."""
from __future__ import annotations

import math
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from scipy import signal
from scipy.io import wavfile

MAX_DURATION = 1800
MAX_DECODED_BYTES = 512 * 1024 * 1024


def _check_wav_limits(path: Path) -> bool:
    """Inspect RIFF metadata before allocating decoded samples."""
    with path.open("rb") as stream:
        header = stream.read(12)
        if len(header) != 12 or header[:4] not in (b"RIFF", b"RIFX") or header[8:] != b"WAVE":
            return False
        endian = "<" if header[:4] == b"RIFF" else ">"
        fmt = None
        for _ in range(1024):
            chunk = stream.read(8)
            if len(chunk) < 8:
                raise ValueError("The WAV header is incomplete.")
            size = struct.unpack(endian + "I", chunk[4:])[0]
            if chunk[:4] == b"fmt ":
                payload = stream.read(min(size, 64))
                if len(payload) < 16:
                    raise ValueError("The WAV format header is incomplete.")
                _, channels, sr, _, alignment, _ = struct.unpack(endian + "HHIIHH", payload[:16])
                if not 1 <= channels <= 8 or not 1000 <= sr <= 192000 or alignment < channels:
                    raise ValueError("Use a supported WAV sample rate and 1–8 channels.")
                fmt = channels, sr, alignment
                stream.seek(size - len(payload) + (size % 2), 1)
            elif chunk[:4] == b"data":
                if fmt is None:
                    raise ValueError("The WAV data precedes its format header.")
                channels, sr, alignment = fmt
                frames = size // alignment
                if frames / sr > MAX_DURATION:
                    raise ValueError("Recording exceeds the 30-minute decoding limit; split it into shorter files.")
                if frames * channels * 4 > MAX_DECODED_BYTES:
                    raise ValueError("Decoded audio exceeds the 512 MiB limit. Split or downsample it.")
                return True
            else:
                stream.seek(size + (size % 2), 1)
        raise ValueError("The WAV header has too many chunks.")


def read_audio(path: Path) -> tuple[int, np.ndarray]:
    """Return native-rate float32 frames x channels, preserving source amplitude."""
    if path.suffix.lower() == ".wav":
        if not _check_wav_limits(path):
            return _decode(path)
        try:
            # Reject oversized files before allocating a second decoded copy.
            if path.stat().st_size > MAX_DECODED_BYTES + 1024 * 1024:
                raise ValueError("Decoded audio exceeds 512 MiB. Split the recording.")
            sr, raw = wavfile.read(path)
        except (ValueError, OSError):
            return _decode(path)
        if raw.dtype == np.uint8:
            data = (raw.astype(np.float32) - 128) / 128
        elif np.issubdtype(raw.dtype, np.integer):
            data = raw.astype(np.float32) / float(2 ** (raw.dtype.itemsize * 8 - 1))
        else:
            data = raw.astype(np.float32)
        if data.ndim == 1:
            data = data[:, None]
        _validate(sr, data)
        return int(sr), data
    return _decode(path)


def _validate(sr: int, data: np.ndarray) -> None:
    if not 1000 <= sr <= 192000 or data.ndim != 2 or not len(data):
        raise ValueError("The file does not contain supported audio.")
    if not 1 <= data.shape[1] <= 8 or len(data) / sr > MAX_DURATION:
        raise ValueError("Use recordings of up to 30 minutes and 8 channels; split longer recordings.")
    if data.nbytes > MAX_DECODED_BYTES:
        raise ValueError("Decoded audio exceeds 512 MiB. Split or downsample the recording.")
    if not np.isfinite(data).all():
        raise ValueError("Audio contains invalid sample values.")


def _decode(path: Path) -> tuple[int, np.ndarray]:
    try:
        return _decode_impl(path)
    except ValueError:
        raise
    except (OSError, RuntimeError, EOFError, subprocess.TimeoutExpired) as exc:
        raise ValueError("Unable to decode this recording. Check the audio format and decoder setup; the original file was not imported.") from exc


def _decode_impl(path: Path) -> tuple[int, np.ndarray]:
    # PyAV is used when installed; it ships its own FFmpeg libraries on Windows.
    try:
        import av
    except ImportError:
        av = None
    if av is not None:
        chunks, size = [], 0
        with av.open(str(path), options={"protocol_whitelist": "file,pipe"}) as container:
            if not container.streams.audio:
                raise ValueError("No audio stream was found.")
            stream = container.streams.audio[0]
            sr = int(stream.codec_context.sample_rate or 0)
            resampler = None
            for frame in container.decode(stream):
                if resampler is None:
                    sr = int(frame.sample_rate or sr)
                    if not 1000 <= sr <= 192000 or not 1 <= len(frame.layout.channels) <= 8:
                        raise ValueError("Unsupported audio sample rate or channel count.")
                    resampler = av.audio.resampler.AudioResampler(format="fltp", rate=sr, layout=frame.layout)
                for converted in resampler.resample(frame):
                    arr = converted.to_ndarray().T.copy()
                    size += arr.nbytes
                    if size > MAX_DECODED_BYTES or size / (sr * arr.shape[1] * 4) > MAX_DURATION:
                        raise ValueError("Recording exceeds the decoding limit; split it into shorter files.")
                    chunks.append(arr)
            if resampler is not None:
                for converted in resampler.resample(None):
                    arr = converted.to_ndarray().T.copy()
                    size += arr.nbytes
                    if size > MAX_DECODED_BYTES or size / (sr * arr.shape[1] * 4) > MAX_DURATION:
                        raise ValueError("Recording exceeds the decoding limit; split it into shorter files.")
                    chunks.append(arr)
        if not chunks:
            raise ValueError("The audio stream is empty.")
        data = np.concatenate(chunks).astype(np.float32)
        _validate(sr, data)
        return sr, data
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise ValueError("Install the base requirements (including PyAV), or put FFmpeg on PATH. PCM WAV works without it.")
    with tempfile.TemporaryDirectory() as tmp:
        target = Path(tmp) / "decoded.wav"
        result = subprocess.run(
            [ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(path), "-t", str(MAX_DURATION + 1),
             "-map", "0:a:0", "-c:a", "pcm_f32le", "-fs", str(MAX_DECODED_BYTES + 1024 * 1024), "-y", str(target)],
            capture_output=True, timeout=180,
        )
        if result.returncode:
            raise ValueError("Unable to decode this file. Check that it contains a supported audio stream.")
        if target.stat().st_size > MAX_DECODED_BYTES:
            raise ValueError("Decoded audio exceeds the memory limit.")
        return read_audio(target)


def write_audio(path, sr: int, data: np.ndarray, encoding: str = "FLOAT32") -> None:
    """Write native-rate audio. Float32 retains the exact working samples.

    Integer exports use correct signed full-scale mapping and deterministic
    triangular dither. They reject over-range input instead of silently clipping.
    ``path`` can also be a BytesIO for browser previews.
    """
    values = np.asarray(data, dtype=np.float32)
    _validate(sr, values[:, None] if values.ndim == 1 else values)
    if encoding not in ("FLOAT32", "PCM24", "PCM16"):
        raise ValueError("Choose FLOAT32, PCM24, or PCM16 WAV encoding.")
    if isinstance(path, (str, Path)):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
    if encoding == "FLOAT32":
        wavfile.write(path, sr, values)
        return
    if float(np.max(np.abs(values))) > 1.0:
        raise ValueError("Integer WAV cannot preserve over-range samples. Use FLOAT32 or enable headroom cleanup.")
    bits = 24 if encoding == "PCM24" else 16
    scale = 2 ** (bits - 1)
    # Stable dither makes repeated exports reproducible; it is never used for float.
    rng = np.random.default_rng(72603)
    quantized = np.rint(values.astype(np.float64) * scale + rng.random(values.shape) - rng.random(values.shape))
    quantized[values <= -1] = -scale
    quantized[values >= 1] = scale - 1
    quantized = np.clip(quantized, -scale, scale - 1).astype(np.int32)
    if bits == 16:
        wavfile.write(path, sr, quantized.astype(np.int16))
        return
    channels = values.shape[1] if values.ndim == 2 else 1
    packed = quantized.reshape(-1).astype('<i4').view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    padding = b'\0' if len(packed) % 2 else b''
    header = (b'RIFF' + struct.pack('<I', 36 + len(packed) + len(padding)) + b'WAVEfmt '
              + struct.pack('<IHHIIHH', 16, 1, channels, sr, sr * channels * 3, channels * 3, 24)
              + b'data' + struct.pack('<I', len(packed)))
    if isinstance(path, Path):
        with path.open('wb') as stream:
            stream.write(header + packed + padding)
    else:
        path.write(header + packed + padding)


def mono(data: np.ndarray, channel: int | None = None) -> np.ndarray:
    if data.ndim == 1:
        return data
    return data[:, channel] if channel is not None else data.mean(axis=1)


def resample(data: np.ndarray, sr: int, target: int = 16000) -> np.ndarray:
    if sr == target:
        return data.astype(np.float32, copy=False)
    divisor = math.gcd(sr, target)
    return signal.resample_poly(data, target // divisor, sr // divisor).astype(np.float32)


def activity_regions(data: np.ndarray, sr: int) -> list[tuple[float, float]]:
    """Energy activity gate, NOT a speech/identity classifier. Music may pass."""
    x = resample(mono(data), sr, 16000)
    hop = 320
    blocks = np.pad(x, (0, (-len(x)) % hop)).reshape(-1, hop)
    rms = np.sqrt(np.mean(blocks ** 2, axis=1))
    if not len(rms) or np.max(rms) < 1e-5:
        return []
    floor = np.percentile(rms, 15)
    threshold = max(0.001, min(floor * 3, float(np.max(rms)) * 0.18))
    active = rms > threshold
    # Bridge gaps of <=160 ms; keep >=180 ms activity.
    active = signal.convolve(active.astype(float), np.ones(5), mode="same") > 0
    indices = np.flatnonzero(np.diff(np.r_[False, active, False].astype(int)))
    regions = []
    for a, b in zip(indices[::2], indices[1::2]):
        start, end = max(0, a * 0.02 - 0.02), min(len(x) / 16000, b * 0.02 + 0.02)
        if end - start < 0.18:
            continue
        if regions and start - regions[-1][1] <= 0.16:
            regions[-1] = (regions[-1][0], end)
        else:
            regions.append((round(start, 4), round(end, 4)))
    return regions


def waveform(data: np.ndarray, bins: int = 600) -> list[float]:
    # Show channel energy even if opposite-phase stereo cancels in a mono mix.
    x = np.abs(data) if data.ndim == 1 else np.max(np.abs(data), axis=1)
    stride = max(1, math.ceil(len(x) / bins))
    return [round(float(np.max(x[a:a + stride])), 4) for a in range(0, len(x), stride)]


def summarize(values: list[float]) -> dict:
    if not values:
        return {"count": 0, "median": None, "p10": None, "p90": None, "mean": None, "std": None}
    x = np.asarray(values)
    return {"count": len(values), "median": round(float(np.median(x)), 4),
            "p10": round(float(np.percentile(x, 10)), 4), "p90": round(float(np.percentile(x, 90)), 4),
            "mean": round(float(x.mean()), 4), "std": round(float(x.std()), 4)}


def acoustics(data: np.ndarray, sr: int) -> dict:
    """Pitch by normalized autocorrelation; noise/overlap can invalidate estimates."""
    x = resample(mono(data), sr)
    pitches, harmonicity, rms_frames, centroids = [], [], [], []
    # Bound analysis to at most ~12,000 windows without removing source samples.
    stride = max(320, math.ceil(len(x) / 12000 / 320) * 320)
    frame_size = 640
    hann = np.hanning(frame_size)
    for a in range(0, max(0, len(x) - frame_size + 1), stride):
        frame = x[a:a + frame_size].astype(float)
        rms = float(np.sqrt(np.mean(frame ** 2)))
        rms_frames.append(20 * math.log10(max(rms, 1e-10)))
        if rms < 0.002:
            continue
        centered = frame - frame.mean()
        spec = np.abs(np.fft.rfft(centered * hann))
        freqs = np.fft.rfftfreq(frame_size, 1 / 16000)
        centroids.append(float(np.sum(spec * freqs) / max(np.sum(spec), 1e-10)))
        corr = signal.fftconvolve(centered, centered[::-1], mode="full")[frame_size - 1:]
        # Extra neighbors allow fundamentals at both advertised search boundaries.
        lags = np.arange(math.ceil(16000 / 500) - 1, min(frame_size - 2, math.floor(16000 / 65) + 1) + 1)
        # Normalize each lag by the energy of the two overlapping windows.
        energies = np.r_[0, np.cumsum(centered ** 2)]
        denom = np.sqrt((energies[frame_size - lags]) * (energies[-1] - energies[lags]))
        scores = corr[lags] / np.maximum(denom, 1e-10)
        peaks, _ = signal.find_peaks(scores)
        peaks = peaks[(lags[peaks] >= 16000 / 500 - 0.5) & (lags[peaks] <= 16000 / 65 + 0.5)]
        if not len(peaks):
            continue
        best = float(np.max(scores[peaks]))
        if best < 0.65:
            continue
        # Prefer the first strong peak to avoid selecting subharmonics.
        selected = int(peaks[scores[peaks] >= max(0.65, best * 0.95)][0])
        lag = float(lags[selected])
        if 0 < selected < len(scores) - 1:
            l, c, r = scores[selected - 1:selected + 2]
            denominator = l - 2 * c + r
            if abs(denominator) > 1e-10:
                lag += float(0.5 * (l - r) / denominator)
        pitches.append(16000 / lag)
        harmonicity.append(float(scores[selected]))
    native = mono(data).astype(np.float64)
    rms = float(np.sqrt(np.mean(native ** 2))) if len(native) else 0
    return {"duration_seconds": round(len(data) / sr, 4),
            "sample_rate_hz": sr, "analysis_sample_rate_hz": 16000,
            "peak_dbfs": round(20 * math.log10(max(float(np.max(np.abs(data))), 1e-10)), 4) if len(data) else None,
            "rms_dbfs": round(20 * math.log10(max(rms, 1e-10)), 4),
            "clipping_fraction": round(float(np.mean(np.abs(data) >= 0.999)), 6) if len(data) else 0,
            "pitch_hz": summarize(pitches), "voicing_periodicity": summarize(harmonicity),
            "frame_energy_dbfs": summarize(rms_frames), "spectral_centroid_hz": summarize(centroids),
            "estimated_voiced_frame_fraction": round(len(pitches) / max(len(rms_frames), 1), 4),
            "method": "40ms normalized-autocorrelation frames; 65-500Hz search; periodicity >=0.65",
            "limitations": ["Pitch estimates can be wrong with music, noise, or overlapping voices.",
                            "No gender, age, accent, emotion, clinical voice quality, or identity is inferred.",
                            "Energy gating detects acoustic activity, not necessarily speech."]}


def subtract_regions(start: float, end: float, blockers: list[tuple[float, float]]) -> list[tuple[float, float]]:
    pieces = [(start, end)]
    for left, right in sorted(blockers):
        next_pieces = []
        for a, b in pieces:
            if right <= a or left >= b:
                next_pieces.append((a, b))
            else:
                if a < left:
                    next_pieces.append((a, min(b, left)))
                if right < b:
                    next_pieces.append((max(a, right), b))
        pieces = next_pieces
    return [(a, b) for a, b in pieces if b - a >= 0.12]
