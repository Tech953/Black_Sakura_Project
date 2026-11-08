# Voice Profile Studio — project audit

Completed **5 October 2026**. Corrected release: **1.2.0**. Reference-pack schema: **1.1.0**, with legacy 1.0 packs supported by the SDK.

**98 Python tests and 15 JavaScript state regressions pass on the combined release.** Installed-package startup, interface assets, import/authoring/binding, a hash-verified reference download, second-writer refusal, and clean shutdown also pass. Verified defects were corrected while preserving the newer audio-quality features.

The original delivered 1.0 archive passed its 30 existing tests despite failures in attribution, editing, validation, and exports. During this audit a newer 1.1 release became available. The final release merges those additions with the audit fixes; it does not discard the newer FLOAT32/PCM24 exports, cleanup controls, quality reports, stable assignment controls, or recorded browser/model evidence.

## Findings and corrections

High priority identifies potential loss of authored information or incorrect association of another speaker's material. Medium identifies accuracy, integration, or protection defects. All listed corrections are present in 1.2; execution limits appear below.

| Priority | Finding | Corrected behavior and evidence |
|---|---|---|
| High | Rerunning detection reused arbitrary speaker labels with old named bindings. Deleted tracks retained bindings. | New analysis clears bindings, retains previous metadata under `recordings/<id>/history/`, and removes obsolete bindings. Reanalysis/history and pruning regressions pass. |
| High | Mixed ASR words could be assigned to the dominant speaker, including with an exclusive timeline; the UI attached whole phrases to intersecting profiles. | Simultaneous-speaker words remain ambiguous and unassigned. The UI and export use the same word attribution. Unequal-overlap/exclusive-timeline and UI log checks pass. |
| High | Switching items discarded drafts; stale saves replaced newer data; typing during a save could lose later edits. | Region and character drafts persist per item within the tab. Region, canon, binding, and cleanup writes can check the editor's original revision. Later edits remain pending. Pending drafts block export. Engine, HTTP, switching, polling, and save-race checks pass. |
| High | Invalid persona lists, non-text prompts, and nonexistent embedded source citations were accepted. | Nested defaults/types and attached source IDs are validated. Legacy export normalization preserves canon and extension fields without rewriting stored data. Character/citation/legacy checks pass. |
| Medium | Malformed source fields poisoned a character draft; historical draft jobs could replace the current editor. | Invalid candidates are skipped with reasons; canon conflicts remain reviewable. Prior-session draft results are not replayed. Source drafting and UI checks pass. |
| Medium | Duplicate annotations repeated same-signal audio and inflated duration. | Already exported spans for the same profile/signal are subtracted. Independent physical channels remain distinct. Duplicate-duration regression passes. |
| Medium | Pitch estimates missed 65 Hz and returned about 250 Hz for a 500 Hz tone. | Boundary peaks have neighboring lag samples. Independent tones at 65, 70, 180, 270, 480, and 500 Hz pass; these do not measure human-voice accuracy. |
| Medium | ASR text was absent from reference clips and transcribed logs lacked reference links. | Assigned words wholly contained in a clean clip populate its text and link voice logs to references. Text/alignment/link checks pass; timing attribution still requires review. |
| Medium | Decoding/export forced rate/precision conversions; signed PCM mapping was biased; measurements described pre-encoding samples. | Native-rate float decoding, exact FLOAT32 working-sample export, selectable dithered PCM24/PCM16, refusal of silent over-range integer clipping, and delivered-WAV measurements are preserved from 1.1 and covered by current signal tests. |
| Medium | Silence/DC-only, damaged, or low-bandwidth signals could become references; cancellation hid channel energy. | Preserved source/output checks, reversible DC/rumble/fade/headroom/noise conditioning, channel-energy waveform, independent-channel preview, and explicit exclusion reports. Controlled signal tests pass. |
| Medium | PCM quantization could introduce full-scale runs after the eligibility check. | Delivered samples are screened again. Newly rejected clips are removed and counted as excluded. A near-full-scale fixture reproduces and verifies this case. |
| Medium | Expression requests ignored the selected export encoding and quality policy. | The matching reference package honors both selections, including explicitly reviewed 8 kHz references under Standard screening. HTTP regression passes; the request includes the matching download and portable relative path. |
| Medium | URL checks preceded a separate DNS resolution used for connection. | Public numeric addresses are validated and used for the actual connection; redirects are checked and TLS retains the hostname. Socket/DNS fixtures pass; no live rebinding attack was executed. |
| Medium | WAV limits followed allocation; decoder flushing/output were incompletely bounded; local compressed inputs could request network protocols. | RIFF metadata preflight, stream/flush limits, bounded FFmpeg output, and restricted FFmpeg input protocols. Allocation and compressed-decoder checks pass; restrictions are also inspected in source. |
| Medium | Changed clips, boolean prosody, and XML-invalid text could enter expression requests. | SDK hashes, styles, finite nonboolean prosody, and SSML-compatible text are checked. Cleanup numeric fields also reject booleans. Tampering/input regressions pass. |
| Medium | Independent app/CLI processes could write one project. | Entry points hold an OS lock, and shutdown finishes active work before release. Second-server and installed app/CLI checks pass. Direct `Studio` callers must enforce one writer themselves; Windows locking is unexecuted. |
| Medium | Separation models shared a cache; symlinks complicated Windows setup; invalid embeddings could be persisted. | Model-source-specific cache directories, SpeechBrain COPY caching, and finite vector validation. Current provider-contract tests pass; those tests do not perform inference. |
| Medium | CSV annotation text could become spreadsheet formulas. | Formula-like cells are escaped while JSON/reference text stays literal. CSV regression passes. |
| Low | Invalid DOCX gave a generic failure; Unicode folding shifted source-search offsets; late source responses/uploads could target a different editor. | Actionable extraction errors, original-text offsets, fixed upload target IDs, and stale-response guards. Document/HTTP/UI checks pass. |
| Low | Windows setup omitted interpreter/dependency checks and could lose failure exit codes. | Version/bitness checks, `pip check`, and preserved launcher failures. CRLF and source review pass; Windows execution remains unverified. |

## Current verification — release 1.2

| Check | Result |
|---|---|
| Python suite | **98 passed**, including core audio/research, quality, exports, revisions, HTTP, process locks, and provider contracts with fake models. |
| JavaScript state suite | **15 passed**: drafts, polling, stale saves, typing during saves, overlap logs, historical jobs, source races, and cleanup guards. Minimal DOM harness; no rendering/playback engine. |
| Installed package | Version 1.2 wheel builds and installs with `--no-deps` using the host runtime. Actual server/assets, import/authoring/binding/export, download hashes, CLI lock refusal, shutdown, and lock release pass. This is not a clean dependency installation. |
| Static and examples | Python compilation, JavaScript syntax, all UI control IDs, JSON schemas, regenerated examples and hashes, and launcher CRLF checks pass. |
| Fidelity/quality | Exact FLOAT32 samples, bounded PCM24/PCM16 errors, native-rate FFmpeg recovery including 96 kHz/30 kHz content, cleanup properties, source/output rejection, and quantization-induced clipping checks pass. PyAV is absent here, so the decoder test exercises FFmpeg fallback; it does not prove current PyAV execution. |

Current environment: Linux, Python 3.12.14, NumPy 2.3.5, SciPy 1.17.0, system FFmpeg. Counts refer to test methods, some with multiple inputs. New evidence is under `audit-artifacts/current-v1.2/` and in the top-level `audit-*.txt`/JSON logs.

## Retained prior evidence — release 1.1

The newer 1.1 archive contains recorded evidence of **63 regression tests, 15 real Chromium workflow checks, and 12 repeated rapid profile-create/assignment checks**. Its installed package and native-rate PyAV execution were also recorded. Those reports, screenshots, synthetic signal/speech files, and outputs are preserved under `audit-artifacts/prior-v1.1/`. They are historical evidence, not a rerun against the merged 1.2 source.

Its real faster-whisper `tiny.en` CPU/int8 transcription matched a known generated phrase after normalization. Real SpeechBrain SepFormer produced two finite 8 kHz sources from generated speech. The recorded best-permutation SI-SDR improvements were 9.86 dB and 12.64 dB. Recorded FLOAT32 conversion error was zero, with bounded PCM24/PCM16 error and measured noise conditioning. See the preserved `AUDIT.md`, `audio-benchmarks.json`, `live-integrations.json`, and `browser-playtest.json` for fixtures, versions, and exact measurements.

This evidence establishes limited generated-fixture behavior. It does not establish general human-voice accuracy, speaker identity, perceptual quality, or reliability across other models/languages. 8 kHz separated sources require Standard screening and listening review; upsampling cannot restore their bandwidth.

## Verification limits

- No real-world user recordings were supplied. Speaker purity, bleed, naturalness, identity accuracy, and subjective listening quality on those recordings remain unverified.
- The merged 1.2 release was not rerun in Chromium or with actual neural models; its new UI checks use a DOM harness and provider checks use mocks. The prior browser/model evidence is preserved separately.
- Current PyAV execution, native Windows setup/playback/locking, and Python 3.11 execution were not tested. The wheel smoke test reused existing dependencies.
- Actual gated Community-1 inference, the default small Whisper model, other languages/models, and broad accuracy were not benchmarked. Live Wikipedia/Wikidata retrieval was unavailable; research and URL guards use fixtures.
- Synthesis, trained voice cloning, and an autonomous companion runtime require another renderer/program. This app exports references and expression requests.

These limits prevent declaring the complete optional AI workflow production-certified. Every reference requires listening review. Authored review labels and signal checks do not prove speaker purity.

## Reproduce and use

```sh
python -m unittest discover -s tests -v
node tests/test_ui.js
python -m compileall -q voice_studio
node --check voice_studio/web/app.js
python examples/create_sample.py
```

Close the previous app, extract the corrected ZIP into a new folder, run `Setup_Windows.cmd`, then `Start_Windows.cmd`. Existing projects can use the same data directory. Correct malformed legacy fields if newly enforced validation rejects them. Reassign speaker tracks after reanalysis. Drafts survive item switches within the tab and must be saved before closing. Recording history has no graphical restoration interface.

## Input provenance

- Original 1.0 archive SHA-256: `32f455fee1582981311bce157233d42793e4a756c89761745735c2fc169c50d9`.
- Newer 1.1 archive SHA-256: `63189fa45961f9c2ca5a62de2cd2c301af93f7e35185be2b42e25be3175d9a2b`.

The merge used immutable copies of both inputs and an isolated audit source folder. Model weights and temporary project data are not bundled. Examples and retained processing fixtures are synthetic and illustrative.
