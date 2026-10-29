"""Native diagnostic only: neutral fixture, no engram/seed/database access."""
import json
import os
from pathlib import Path
import subprocess
import sys

root = Path(sys.argv[1]).resolve()
os.environ.update({
    "VOICE_STUDIO_MODEL_ROOT": str(root / "models"), "HF_HUB_OFFLINE": "1",
    "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
    "DO_NOT_TRACK": "1", "QT_QPA_PLATFORM": "offscreen",
})
from voice_studio.runtime import enforce_offline, health

enforce_offline()
status = health(full=True)
if not status["passed"]:
    raise RuntimeError(f"Bundled resource health failed: {status}")
# Resolve the ASR dependency chain before spending time on CPU synthesis.
# CTranslate2 4.5.0 needs the pkg_resources provider pinned in requirements.
from faster_whisper import WhisperModel

probe = root / "diagnostic"
probe.mkdir()
reference = probe / "neutral-reference.wav"
text = "This is an offline runtime test reference. No character identity is represented."
subprocess.run([str(root / "vendor/espeak-ng/espeak-ng.exe"),
                f"--path={root / 'vendor/espeak-ng'}", "-v", "en", "-w", str(reference), text], check=True)
from f5_tts.api import F5TTS

engine = F5TTS(model="F5TTS_v1_Base", ckpt_file=str(root / "models/tts/model_1250000.safetensors"),
               vocab_file=str(root / "models/tts/vocab.txt"),
               vocoder_local_path=str(root / "models/vocos"), device="cpu")
speech = probe / "neutral-generated.wav"
engine.infer(ref_file=str(reference), ref_text=text, gen_text="The local speech runtime test has completed.",
             file_wave=str(speech), nfe_step=16, seed=42)
if speech.stat().st_size < 48000:
    raise RuntimeError("Speech output is missing or too short")
del engine
asr = WhisperModel(str(root / "models/asr"), device="cpu", compute_type="int8")
segments, _ = asr.transcribe(str(speech), language="en", beam_size=1, vad_filter=False)
transcript = " ".join(segment.text for segment in segments).strip()
if not transcript:
    raise RuntimeError("Local ASR returned an empty diagnostic transcript")
from PySide6.QtGui import QGuiApplication, QFontDatabase, QImage, QPainter

app = QGuiApplication([])
for font in (root / "fonts").iterdir():
    if font.suffix in (".otf", ".ttf") and QFontDatabase.addApplicationFont(str(font)) < 0:
        raise RuntimeError(f"Bundled font failed to load: {font.name}")
frame = QImage(640, 360, QImage.Format.Format_ARGB32)
frame.fill(0xff101820)
painter = QPainter(frame)
painter.drawText(30, 80, "Offline renderer dependency diagnostic — not a character likeness")
painter.end()
if not frame.save(str(probe / "font-renderer.png")):
    raise RuntimeError("Renderer dependency diagnostic failed")
(probe / "result.json").write_text(json.dumps({
    "nativeWindows": os.name == "nt", "resourceHealth": status,
    "speechGenerated": True, "localASRTranscript": transcript, "qtFontProbePassed": True,
    "fullCharacterRendererAccepted": False, "rebeccaVoiceAccepted": False,
    "networkGuardEnabled": True, "freshInstallAccepted": False,
}, indent=2), encoding="utf-8")
