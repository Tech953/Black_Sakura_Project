# Voice Profile Studio 2.0
Release audit / 12 October 2026

## Completed source and processing checks
The rebuilt source integrates native desktop authoring, audio import/annotation, reversible cleanup, anonymous speaker clustering, local transcription/separation, F5/Vocos synthesis, spectrum, listening review, revision history, exports and editable backup. The Replit handoff supplies the corrected source, actual adapters, schemas, example archive, integration architecture, task query and tests for an existing engram application.

Current program regression tests: 87 passed (29 core, 24 audio quality, 26 audit/provenance, 8 offline/spectrum/history). Framework-neutral engram integration tests: 12 passed. The source-only smoke check passed without model inference. These are local checks, not a deployment into the user's unseen engram software.

All nineteen bundled model assets passed full SHA-256 checks. F5 pretrained weights retain hash 670900fd14e6c458b95da6e9ed317cdb20dbaf7a1c02ac06a05475a9d32b6a38. Weights were not precision-reduced or modified. Current local model execution passed Whisper base transcription, ECAPA anonymous clustering and two-source SepFormer separation. Separation retained finite 34800-by-2 output at 8 kHz with a peak of 8.91745; purity and identity remain unverified.

The default thirty-two-step F5/Vocos render completed through the native QProcess worker: 8.309333 seconds of 24 kHz mono PCM16 audio, 165.74 CPU seconds. Its new word check passed at 6.25% WER (one error out of sixteen expected tokens) against the twenty-percent criterion. Audio SHA-256: 975749ec79ecdf5a853e6274d6a9c09f0388adec8a56a1c638b4eeb318524cd5. Likeness, naturalness, delivery, reference purity and canon-boundary ratings remain unreviewed.

The native interface passed thirteen checks, including loading the archive, custom-field/revision retention, PCM16 preview preparation, append-only review, preservation of a failed historical word check and successful real model worker execution. Six native screenshots were captured and visually reviewed. Preparing a preview is not verification of a Windows playback device.

Static Windows PE import-name coverage checked 554 executable/DLL/PYD files with no unresolved non-system names. This does not prove exported-symbol/ABI compatibility, Windows DLL search behavior or execution. Final installer compilation/archive/payload outcomes are recorded separately in Packaging_Checks.json; no pending packaging step is counted as passed here.

## Outstanding boundaries
Actual Windows installation, startup, audio-device playback, full offline acceptance and uninstall execution have not been tested. Installer unsigned. Human voice/likeness/delivery review remains pending. Replit integration is a ready-to-import handoff, not an already modified or deployed engram app. A hosted Replit app cannot automatically access a local desktop model runtime; register assets and demonstrate real inference before marking rendering available.

<!-- PAGE BREAK -->
## Offline correction and preserved failures
Automatic approval review previously rejected a live inference action after detecting an unauthorized Microsoft telemetry connection from the optional ONNX dependency. That earlier attempt is not accepted as final offline validation. The corrected runtime excludes ONNX Runtime from the Windows payload and explicitly blocks its import. Whisper uses vad_filter=False; anonymous activity uses local energy gating with ECAPA. Python socket connection entry points are denied within the isolated worker, and models use explicit local paths with offline flags.

This is an application-level offline design and dependency correction, not a Windows packet-capture certification. Offline enforcement is process-wide; an engram host must use the separate worker rather than call inference inside its HTTP-serving process. An active native/CLI workspace lock must not be bypassed.

Workspace maintenance removed earlier unfinished builds. The saved source checkpoint and original Rebecca archive were recovered. Current evidence is regenerated and distinguished from historical claims. An initial fresh native worker terminated without a result; exact build-host LLVM/Numba dependencies were reinstalled and the rerun succeeded. Interrupted run evidence is retained. Worker stdout diagnostics now persist in workspace/jobs rather than disappearing from the interface.

A prior sixteen-step exploratory run had 36.36% WER and was not approved. Its scratch-only run files did not survive maintenance; this is a recorded earlier observation, not a current recovered artifact or current test. The recovered original sample retains its tiny.en failure at 26.67% and base.en pass at 6.67% under the original fifteen-percent criterion. Neither history is silently rewritten by the current multilingual-base check.

A solid-compression installer attempt crashed on the uncompressed payload exceeding two GiB. The corrected build uses per-file zlib/Deflate and one installer; corresponding Qt/PySide source archives are supplied separately in the source ZIP, and model precision and functionality are unchanged. Final packaging success is governed by the actual post-build record. Earlier staging and extraction produced incomplete large files despite a successful tool exit; full size/hash checks caught them. Model copies now stream into temporary files, flush and sync, verify against provenance, then replace atomically. Installer checking independently validates every file and all models; any incomplete extraction is retried from the same archive stream with full hash verification. Earlier failures are retained as history.

## Profile and audit updates
Tone and inflection are circumstance-dependent. Pitch and bass/treble energy are separate. All record edits, cleanup settings, bindings, transcription and reanalysis preserve previous revisions; profile/source edits preserve character revisions. Custom fields, exact hashes, provenance, native-rate originals and raw render output remain recoverable.

Each generation snapshots its profile, source record and model manifest. Rechecks and listening reviews append to history. Five human ratings default to unreviewed. ASR, quality checks, spectra and valid WAV bytes cannot approve identity, naturalness, emotion or purity. F5 executes text, reference and rate; persona prompts and SSML are context metadata.

Rebecca remains the original-anime English posthumous archive, with canonical death as its endpoint and new dialogue authored noncanon. No claim of survival, canonical engram/resurrection, actor performance, dub/crossover/character merging is permitted by the archive metadata contract. Unknown numerical facts and unsupported vocal traits remain unknown. Metadata guards do not automatically prove every authored line agrees with canon.

<!-- PAGE BREAK -->
## Spectral method and preserved mismatch
The original reference measured bass 21.1699%, mid 61.2021%, treble 12.6161% and upper 5.0119%. Its prior generated sample measured bass 0.3613%, mid 66.2896%, treble 32.9730% and upper 0.3760%. That mismatch is preserved. Different words, delivery, mixing and background sound prevent a controlled agreement claim. The reference's initial words and purity still require manual listening verification. No tonal EQ disguises a mismatch.

The current measurement uses anti-aliased 24 kHz mono, 40 ms Hann Welch windows, 20 ms hops, nFFT 4096, constant detrending, interpolated trapezoidal integration and normalization over 20-12000 Hz. Bands: bass 20-250, mid 250-2000, treble 2000-8000 and upper 8000-12000 Hz. Frame percentiles use a -50 dBFS energy floor, not VAD. Equal-amplitude 100 Hz and 4 kHz calibration gives approximately equal bass/treble energy. Silence is unavailable. Spectral comparisons remain descriptive, uncontrolled and separate from pitch and perceptual likeness.

## Export, portability and licensing
SepFormer estimates two anonymous 8 kHz sources from at most thirty seconds. Raw Float32 over-range values are retained and reversible headroom conditioning is enabled. Listen before assigning identity. Standard screening permits reviewed low-bandwidth references; upsampling does not create high fidelity.

Reference exports include crops, hashes/timestamps, dossiers, sources, logs, transcripts, revisions and generation audio/audits. Editable backup retains originals; restore requires an empty destination and rejects path escapes, symlinks and archives over eight GiB. The uninstaller removes only listed application-owned files and empty directories; workspace data is separate. Actual Windows execution of these behaviors is unverified.

The Windows payload bundles private CPython, Qt, codecs and CPU models. No Node, external Python, API key, browser backend or runtime model download is required. All installed paths/bytes/hashes are frozen in the payload manifest; post-build recovery compares the installer against it. Source and Replit handoff exclude duplicate model weights and include the manifest/build acquisition path, preventing a source ZIP from being mistaken for a fully configured model runtime.

F5 pretrained weights remain CC-BY-NC-4.0 with noncommercial restriction and attribution. Qt/PySide is dynamically linked; principal license texts are installed and versioned corresponding source archives accompany the source/audit and Replit ZIPs. Dependency licenses remain in distribution metadata. User recordings retain separate rights; synthetic output is not an official franchise recording or credited performer performance.

## Handoff and acceptance
Give Replit Agent the supplied task query and fileset. Preserve the existing app and its entrypoint, engram fields, authentication, dialogue engine and working features. Use explicit profile binding and the isolated local worker. Missing assets, failed rendering and unreviewed voice quality must remain explicit states. Registering a model file is not successful inference.

Before claiming complete Windows verification, test on a clean Windows x64 computer without Node, Python, model caches or Internet access: window load, import/playback, real ASR/clustering/separation/generation, export, editable backup/restore and uninstall/workspace preservation. This is the outstanding execution boundary.
