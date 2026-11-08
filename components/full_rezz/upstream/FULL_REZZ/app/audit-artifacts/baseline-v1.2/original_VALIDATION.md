# Validation — release 1.2.0, 5 October 2026

**98 Python tests and 15 JavaScript state regressions pass.** Installed-package startup/assets, import/authoring/binding, a hash-verified ZIP download, second-writer refusal, clean shutdown, and lock release pass. Python compilation, JavaScript syntax, schemas, rebuilt examples, UI IDs, and launcher CRLF checks pass.

```sh
python -m unittest discover -s tests -v
node tests/test_ui.js
python -m compileall -q voice_studio
node --check voice_studio/web/app.js
```

Current execution used Linux/Python 3.12.14, NumPy 2.3.5, SciPy 1.17.0, and FFmpeg. The wheel installed with `--no-deps` into an isolated target using existing dependencies; this is not a clean dependency installation. Native WAV and FFmpeg paths passed; PyAV is absent in the current runtime.

`audit-artifacts/current-v1.2/` contains the current logs, static checks, and installed-package results. The top-level logs are copies for convenient inspection. `audit-artifacts/prior-v1.1/` preserves the newer input's 63-test report, 15 Chromium workflow checks, 12 repeated assignment checks, native PyAV evidence, and real tiny.en/SepFormer generated-speech results. Those are prior-version results and were not rerun against merged 1.2.

Unverified on merged 1.2: real browser rendering/playback, actual neural inference, current PyAV execution, Windows installation/locking/playback, Python 3.11, live Wikipedia/Wikidata retrieval, and general accuracy or perceptual fidelity on user recordings. Actual gated Community-1 inference is unverified in both releases. Provider contracts use fake models and UI state checks use a minimal DOM harness.

Synthesis, trained voice cloning, and autonomous character execution require another renderer/program. The deliverable is a source project with launchers. See `AUDIT.md` for findings, evidence provenance, and limits.
