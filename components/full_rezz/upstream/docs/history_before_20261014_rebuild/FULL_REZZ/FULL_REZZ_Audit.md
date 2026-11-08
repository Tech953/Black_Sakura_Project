# FULL_REZZ 2.0 - release audit

9 October 2026. This is a concrete offline application build and self-contained Windows installer candidate. Native Windows install, launch, Qt decoding and clean-machine offline acceptance have not been executed. The installer is unsigned. User guides include the native acceptance procedure.

## Implemented updates

Bundled CPU F5-TTS v1 + Vocos synthesis; bundled English tiny.en ASR; anonymous ECAPA energy-window/cosine speaker grouping; two-source SepFormer; reversible cleanup; native spectral band measures; source-attributed character context; transactional reference-pack restore; original ZIP preservation and re-export; selected-reference playback; WAV/receipt downloads; hash-checked review history; persistent data in the previous location; loopback-only API and embedded Qt shell; local guide and 60 fps demonstration playback.

Runtime models are local. External Python socket/DNS connections and Qt requests are blocked; hosted inference, accounts, model downloads, a separately installed browser, Python, Node and FFmpeg are unnecessary for the installed application. ONNX Runtime is excluded; local transcription runs without its VAD path. The packaged network research UI is disabled; document import remains available.

## Actual verification

- 114 Python tests passed, including 16 new checks for spectrum, floating over-range versus PCM clipping, render constraints, Windows ZIP path rules, rollback, active-pack selection, original byte restoration/re-export and render review integrity and honest overlap-detection metadata.
- 15 interface state regressions passed in a simulated DOM. These verify drafts, revisions and asynchronous editing; they are not a native GUI test.
- 22 pinned model files, totaling 1,683,047,845 bytes, passed size and SHA256 checks.
- Real Linux CPU inference exercised transcription, a 192-dimensional ECAPA embedding, two 8 kHz separated streams and 32-step F5/Vocos synthesis through the loopback HTTP job route.
- Generated statement: "The offline archive is ready." Local ASR matched these normalized words exactly. Output is 2.400 seconds at 24 kHz; the delivered WAV hash matched the receipt. The reference annotation was preserved when the small ASR model misheard source names.
- Imported the actual 339-entry Rebecca ZIP, selected its active reference_pack instead of historical export manifests, remapped IDs, preserved original source dates/character endpoint/history and included the exact original ZIP in re-export. Archive CRC and original SHA256 were verified.
- Reference/WAV/receipt HTTP playback/download bytes and Needs revision history were checked. No human approval was recorded. ONNX Runtime remained absent during all four neural paths.
- Animation: 9 real raster checks; 10 independent export checks; 12 simulated player controls. All 720 rendered frame hashes differ. Independent MP4 decoding confirms 60 fps, 720 frames and 12 seconds at 1280 x 720. Every supplied PCM speech sample is retained at 1.25 seconds; AAC correlation 0.999918, signal-to-error 37.78 dB. All 47 active reference-pack files match the user ZIP exactly.
- WebM VP9/Opus versions are used inside Qt so the demonstration does not require proprietary H.264 Qt playback. Decoded frame counts are checked; native Qt playback remains untested.
- PE normal/delay import closure is inspected against included files and explicit Windows system DLLs. It does not prove actual loader resolution. Installer extraction is independently checked against the staged payload manifest and its hashes; the external FULL_REZZ_Installer_Verification.json records final results.

## Quality and scope limits

No Studio Trigger equivalence, anime timing reproduction, arbitrary sidestep or unseen-pose generation, 3D reconstruction, performer identity/likeness, phoneme alignment or autonomous engram reasoning is claimed. The 60 fps demonstration uses 23 scheduled body drawings; additional frame sampling does not add poses. New generated speech exports separately; automatic re-animation of the demonstration is not implemented. Some cel changes remain visible.

Speaker groups and separation outputs are anonymous and require listening review. Energy activity is not speech detection. Band measurements do not infer emotion. Authored persona/scene notes are recorded context, not guaranteed acting control. Quality screening cannot prove purity or perceptual fidelity. F5 weights use CC-BY-NC-4.0 and restrict this bundled configuration to noncommercial use.

## Evidence

audit-python-results.txt; audit-ui-results.txt; audit-artifacts/offline-integration.json; audit-artifacts/animation_*; audit-artifacts/runtime_manifest.json; bundled_models/manifest.json; bundle_manifest.json; FULL_REZZ_Installer_Verification.json. Historical v1.2 and earlier animation reports are retained and do not describe this build.

## Final installer verification

The compiled installer is 2,089,093,210 bytes. SHA256: `1232d1b909aa8031891d37a43a08718bc053527c3d04652b9dc4cfd70aa7888c`. Independent NSIS extraction verified the sizes and SHA256 hashes of all 13,171 payload files (3,065,704,333 bytes), including streamed verification of the largest model. This is an archive-integrity check, not a native Windows execution test.

Four transport ZIPs contain consecutive fragments of this one installer. FULL_REZZ_Delivery_Manifest.json records their checksums and byte-equivalent reconstruction. Extract all four into one directory and run Assemble_Installer.cmd; Windows built-ins reconstruct and check the installer before starting setup. The assembler itself has not been executed on Windows. The downloaded fragments and assembled installer are not additional installed runtime dependencies.

This final external audit and verification report supplement the audit embedded in the frozen installer. Source packaging includes these post-build results; the installer payload was not changed after compilation.
