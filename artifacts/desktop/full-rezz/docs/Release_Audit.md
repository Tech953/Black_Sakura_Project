# Voice repair candidate — release audit

Base: `c8b945b1b1c2c6a7c20a8564479de6ce636e9447`.
Status: engineering review candidate; not release accepted.

## Repairs

- Reachable health dispatch before project initialization; no spurious Studio mutation on health or microphone transcription.
- Nonempty diarization result no longer references an undefined language variable. Missing optional model groups report unavailable.
- Authenticated, ownership-scoped microphone route, archival/group guards, explicit language validation, duration/upload limits, cancellation, and ephemeral audio cleanup.
- Browser recording returns a transcript to the editable draft, releases devices on cancellation/navigation, and does not automatically send chat text.
- Explicit speech-language/engine routing. F5 remains English/Mandarin; generic multilingual speech is a separate choice.
- Reused reviewed build-download fixes; added pinned speaker/separator assets, current-checkout source staging, and direct native-runtime packaging compatibility with full inventory verification.
- Restored active audio, profiling, language, and offline regression suites from the preserved source component. Existing imported checksums remain unchanged.

## Validation boundaries

Source tests and browser fixtures use controlled signals, mocked model boundaries, or simulated devices. They establish contracts, cleanup, signal handling, and UI behavior. They do not approve real model output, actor likeness, native-speaker pronunciation, speaker purity, full-band isolation, a real microphone/playback device, or performance on the ROG.

The Windows runtime workflow can build and probe the repaired checkout, but a workflow result for an older commit does not accept this candidate. Native Windows clean install, disconnected operation, hardware input/output, restart, repair/upgrade, and uninstall preservation remain required. Review actual runtime/model notices and distribution terms before release.

## Remaining release gates

1. Build the exact reviewed commit's complete Windows runtime and desktop package, with runtime presence required.
2. Install and operate on a clean Windows machine with networking unavailable and no external Python/Node/model service.
3. Complete real microphone → local ASR → reviewed draft → saved reply → bound speech → playback tests, including cancellation and restart.
4. Obtain independent listening approval for references and output. The single Rebecca reference is user-declared, not approved for purity or broad expressive coverage.
5. Validate pronunciation per claimed language. Historical generic multilingual checks are experimental and must not be relabeled as character-conditioned support.
6. Provide and validate a full-band separation path before claiming high-fidelity isolation. The current 8 kHz separator remains explicitly limited-bandwidth.
7. Measure RAM, disk requirements, and generation latency on the target ROG. Do not infer GPU acceleration or real-time performance from menu availability.

The review branch must remain unmerged until these limitations and validation evidence are assessed.
