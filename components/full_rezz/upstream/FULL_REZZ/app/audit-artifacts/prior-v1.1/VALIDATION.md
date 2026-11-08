# Validation — audited release 1.1.0, 2026-10-05

**63 regression checks passed. 15 real Chromium workflow checks passed. 12 rapid create/assign iterations passed.** See `AUDIT.md` for findings, fidelity measurements, cleanup results, real model results, and verification limits.

Verified on Linux/Python 3.12.14 with NumPy 2.3.5, SciPy 1.17.0, PyAV 17.1.0, system FFmpeg, and Chromium 134.0.6998.35. Real neural processing used faster-whisper 1.2.1, SpeechBrain 1.1.1, torch/torchaudio 2.8.0 CPU, and huggingface-hub 0.36.2. Exact versions are in `audit-artifacts/environment.json`.

## Passed

- Native-rate PyAV/FFmpeg decoding, including bit-exact 96 kHz FLAC recovery with a 30 kHz fixture.
- Exact FLOAT32 working-sample export; bounded/dithered PCM24/PCM16 conversion; refusal to silently clip over-range integer exports.
- Original/decoded preservation, channel extraction, overlap exclusion, timeline offsets, hashes, and delivered-WAV measurements.
- Silence/DC-only/clipping/low-rate screening; reversible DC/rumble/fade/headroom processing; selected-noise attenuation; exclusion reports.
- Character/source preservation, Unicode, citations, persona/statistic drafting, canon conflicts, voice logs, prompts, schemas, and rebuilt examples.
- CLI quality/cleanup/export, HTTP startup/jobs, range playback, origin/session protection, matching expression-package downloads, invalid-input handling.
- Actual browser playback, edit/save guards, character/source workflow, cleanup previews, exports, expression JSON, narrow viewport, and zero uncaught JavaScript errors.
- Real tiny.en transcription and two-source SepFormer inference on generated speech, including browser actions and recording creation.
- Repeated rapid assignments after the interface refresh fix.
- Installed-package startup outside the source folder; compilation; JavaScript syntax; HTML controls; schemas; dependency consistency.

## Still unverified

- Real-world recordings and subjective audio listening quality.
- Native Windows launch/playback and Python 3.11 execution.
- Actual gated Community-1 inference, default small Whisper model, other languages/models, and broad real-world accuracy.
- Live Wikipedia/Wikidata retrieval in this network: host resolution failed; failures were surfaced. Provider fixtures and local documents passed.
- Speech synthesis, trained cloning, and autonomous character execution require another renderer/program.

Community-1 contract tests are distinct from real transcription/separation inference. Generated fixtures do not substitute for human recordings. Package presence alone is not counted as successful inference.
