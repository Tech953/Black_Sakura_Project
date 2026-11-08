# Voice Profile Studio 1.1.0 — audit and play-test

Date: 2026-10-05. This release fixes verified fidelity, reference handling, and interface defects in 1.0. It remains a Python source project with Windows launchers, rather than a compiled installer.

## Results

**63 regression tests, 15 real Chromium workflow checks, and 12 consecutive rapid profile-create/assignment checks passed.** Installed-package startup outside the source folder retained its interface assets and returned HTTP 200. Python compilation, JavaScript syntax, control IDs, schemas, regenerated examples, and dependency consistency passed.

These results establish the tested behavior on Linux with generated recordings. They do not certify the perceptual quality of recordings that were not supplied.

## Corrections

| Finding in 1.0 | Behavior in 1.1 |
|---|---|
| FFmpeg fallback forced 48 kHz and 16-bit PCM | Both decoders retain native rate and float32 working precision; 96 kHz FLAC/30 kHz content recovered without sample changes |
| All exports used 16-bit WAV and biased full-scale mapping | Exact FLOAT32 working-sample export; selectable, correctly mapped and dithered PCM24/PCM16 |
| Measurements described the signal before encoding | References are measured after writing and rereading the delivered WAV |
| No source/output quality workflow or noise conditioning | Channel checks, selected-region measurements, original/cleaned playback, and saved reversible cleanup |
| Silent, damaged, or low-bandwidth signals could appear as references | Explicit screening and exclusion reports; default policy excludes unusable signals, likely clipping, output over-range samples, and rates below 22.05 kHz |
| Opposite-phase channels could appear as an empty waveform | Channel-energy waveform and unusable-mix detection, with independent channel extraction |
| Rapid profile creation could drop the next speaker assignment | Stable binding controls, delegated changes, protected writes, and coalesced refreshes; 12 repeated checks passed |
| Unsaved edits could be lost or omitted | Save/discard guards for region, character, and cleanup edits |
| Reanalysis/deleted tracks could retain stale identities | Fresh assignments for newly detected labels; obsolete bindings removed |
| Overlapping words could be assigned from timing dominance | Simultaneous-speaker words remain ambiguous with candidate labels |
| Expression JSON lacked its exact reference download | Matching package link and portable relative audio path |
| Changed exported clips were accepted | SDK verifies reference SHA-256 hashes |
| SpeechBrain caching required symlink support | COPY caching avoids relying on Windows symlink privileges |

## Audio fidelity measurements

Fixture: 3 seconds of a known 220 Hz signal at 48 kHz, 144,000 frames, amplitude 0.2. Compare the decoded exported WAV with the source working samples. This measures conversion error, rather than room noise or perceived voice quality.

| Encoding | Rate / frames retained | Maximum absolute sample error | Signal-to-quantization-error ratio |
|---|---|---:|---:|
| FLOAT32 | Yes | **0** | Exact samples; no introduced quantization error |
| PCM24 | Yes | 1.733 × 10⁻⁷ | 127.50 dB |
| PCM16 | Yes | 4.541 × 10⁻⁵ | 79.36 dB |

Larger export formats cannot restore compressed detail, low source bandwidth, or clipping. Original audio bytes are preserved. Float32 working audio does not retain every bit of original 32-bit integer or 64-bit float input.

## Cleanup measurements

A deterministic 48 kHz fixture contained a noise-only lead-in, Gaussian noise, and 0.025 DC offset. With the selected noise excerpt and a 9 dB maximum attenuation setting, noise fell **8.41 dB after compensating for gain**, duration/rate stayed unchanged, output peak was **−3.00 dBFS**, full-scale clipping fraction was **0**, and output DC was about **0.000157**.

A separate filter check verified strong 20 Hz rumble attenuation while retaining a 220 Hz harmonic within 0.15 dB after gain compensation. Fades reached zero at boundaries without removing frames. See `audio-benchmarks.json` and `test_audio_quality.py` for reproducible evidence.

These controlled results do not establish speech enhancement quality across real rooms, music, background speakers, or every voice. Noise reduction can alter timbre and needs an excerpt without speech or music. It is off by default.

## Real model processing

**Transcription:** faster-whisper 1.2.1, tiny.en, CPU/int8, word timestamps and VAD. The browser transcribed generated speech; wording matched the known phrase after punctuation/case normalization. One fixture does not establish an accuracy rate for real recordings or other languages/models.

**Separation:** SpeechBrain 1.1.1 / SepFormer WSJ0-2Mix, torch/torchaudio 2.8.0 CPU. Two generated voices produced finite source arrays at 8 kHz with the expected duration. Against the isolated fixtures, using the best source permutation:

| Known source | Mixture SI-SDR | Separated SI-SDR | Improvement |
|---|---:|---:|---:|
| A | 3.71 dB | 13.57 dB | 9.86 dB |
| B | −3.70 dB | 8.94 dB | 12.64 dB |

SI-SDR compares known signals after scale alignment; it does not certify identity or perceptual fidelity. Both engine and browser import workflows passed with anonymous source provenance. **8 kHz estimates are excluded by default high-fidelity screening.** Standard screening is available after review; upsampling would not restore bandwidth.

**Diarization:** Community-1 interface, waveform conversion, embeddings/timelines, overlap handling, and missing-backend behavior passed contract checks. Real gated model inference was not run. The browser displayed setup requirements without invented speaker labels.

## Coverage

Every supplied source module, UI asset, schema, launcher, example, and existing test was inspected. Executed checks covered audio formats/decoders, original hashes, native-rate extraction, overlap/review, timeline offsets, independent pitch fixtures, source documents, Unicode, DOCX tables, scanned-PDF warnings, research fixtures, biography/demographics/statistics/persona, prompts, citations, canon conflicts, logs, subtitles, package contents, SDK selection, expression validation, CLI, HTTP jobs, origin/session protection, range playback, and installed assets.

Real browser checks covered empty startup, playback, region edits, profiles/assignments, document import/search/drafting, invalid JSON, failed URL research, cleanup/measurements, ZIP download, expression JSON and matching audio, actual transcription/separation, unavailable diarization, narrow viewport, and uncaught-error checks.

`audit-artifacts/` contains logs, machine-readable results, screenshots, and generated signal/speech fixtures. These are not user recordings or evidence of a cloned person. Model weights and temporary workspaces are not bundled.

## Verification limits

- **No real-world user recordings were supplied.** Speaker purity, bleed, naturalness, and subjective listening quality on those files remain unverified. Every reference requires listening review.
- Native Windows launch/playback and Python 3.11 were not executed. Launchers' CRLF structure was checked; execution used Linux/Python 3.12.
- Live Wikipedia/Wikidata hosts could not resolve in this environment. Provider fixtures and local documents passed; real connection failures were displayed accurately.
- Actual gated Community-1 inference, the default small Whisper model, other languages/models, and broad real-world inference accuracy were not benchmarked.
- Speech synthesis, trained cloning, and autonomous character execution require another renderer/program.
- Use one app/CLI writer per data folder. Independent processes do not share the process-local write lock.

## Reproduce

```sh
python -m unittest discover -s tests -v
python -m compileall -q voice_studio
node --check voice_studio/web/app.js
python -m pip install -r requirements-audit.txt
python -m playwright install chromium --only-shell
python tests/playtest_browser.py
```

Optional AI checks need installed/cached backends; setup is in `README.md`. Exact versions and evidence are in `environment.json`, `audio-benchmarks.json`, `live-integrations.json`, `browser-playtest.json`, `assignment-timing.json`, `installed-package.json`, `static-checks.json`, and test logs under `audit-artifacts/`.
