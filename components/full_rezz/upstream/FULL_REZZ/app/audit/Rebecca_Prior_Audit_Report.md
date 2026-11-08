# Rebecca audit report

7 October 2026 — completed source/profile build and newly synthesized test.

**Source/profile checks: 90/90 passed. Delivery checks: 15/15 passed.** These are automated technical checks. Speaker likeness, naturalness, and reference purity remain unverified by listening.

## Actual generated clip

The local F5-TTS v1 base model generated **8.309 seconds** of new mono speech at **24,000 Hz**, supplied as PCM16 WAV and 96 kb/s MP3. Synthesis took 165.082 seconds on CPU, including model loading. The audio speaks:

> Non-canon archive simulation. Easy, choom. Big attitude, tiny patience. Now let's hear what you've got.

The archived reference was not substituted for the new performance. The actual generation flag, model provenance, parameters, versions, conditioning transcript, source crop, processing details, and hashes are in `synthetic_test/Rebecca_Render_Details.json`. The raw FLOAT32 generation and native-rate conditioning copy are also retained.

## Spoken-word check

Final offline **openai/whisper-base.en** transcription:

> Non-canon archive simulation. Easy chume. Big attitude, tiny patience. Now let's hear what you've got.

Token edit distance: **1 error / 15 expected words**, or **6.67% WER**. The predeclared criterion was at most 15%. Exact normalized match: **false**. Case, punctuation, and non-canon spacing are normalized; street slang is not remapped to manufacture a match. The result is in `synthetic_test/Spoken_Audio_Check.json`. ASR errors and synthesis errors cannot always be distinguished without listening.

| Transcription model | Token errors | WER | Stated criterion |
|---|---:|---:|---|
| openai/whisper-tiny.en | 4/15 | 26.67% | Fail |
| openai/whisper-base.en | 1/15 | 6.67% | Pass |

The first tiny.en check failed after interpreting the opening label as “No, in Canada” and spelling “choom” as “Chume.” The larger base.en recheck recovered the label and retained the “chume” spelling mismatch. **The initial failure is retained**, both in the render details and `synthetic_test/Spoken_Audio_Check_tiny.en.json`. No synthesis rerender, transcript correction, or slang normalization was used to change that outcome. Passing the final base.en criterion does not mean every transcription check passed or that a human listener verified the words.

## Signal quality and processing

| File/signal | Peak dBFS | RMS dBFS | Automated status | Issue codes |
|---|---:|---:|---|---|
| RAW | -2.3908 | -22.9154 | signal_checks_passed | None |
| WAV | -2.9996 | -23.5245 | signal_checks_passed | None |
| MP3 | -3.3831 | -23.9681 | signal_checks_passed | None |

The delivery audit independently decoded both formats, verified finite samples, 24 kHz rate, duration, headroom, hashes, and byte counts. The adapter applied -0.6092 dB of gain toward a −3 dBFS peak and 5 ms edge fades. It added no pitch shift, reverb, or radio effect. Warning codes, if present, are retained; passing technical delivery checks does not erase a signal heuristic warning. Quiet-frame contrast is not calibrated speech/noise SNR.

Generated acoustic measurements are in `synthetic_test/Generated_Acoustics.json`. They characterize this output and do not score identity or infer demographic attributes. The reference statistics and their method limits remain in the profile and `evidence/reference_acoustics.json`.

## Reference and source audit

Seven unchanged uploads were hashed and decoded over their full durations and all channels. Four extracted crops were checked against exact parent samples. One **4.35-second, 44.1 kHz FLOAT32** source-attributed concern reference passed signal screening and was exported unprocessed. Three unreviewed candidates were excluded. The five crossover uploads cannot revise the selected original-anime endpoint or enter its conditioning set.

The source/profile checks validate schemas, source-note hashes and field mapping, explicit style fallback, contradictory-source preservation, overlap exclusion, prosody validation, and actual app page/job/ZIP behavior. The packaged notes are authored source summaries; their hashes verify those notes, not captured webpage originals. `evidence/profile_checks.json` lists all 90 checks. Source-conflict fixtures test software merge behavior, not an LLM's compliance. No live LLM persona test was run.

The 15 additional delivery checks and combined results appear in `evidence/complete_audit.json`. The ZIP's contents and hashes are enumerated in `package_inventory.json`; ZIP CRC and containment are checked by the packaging script.

## File integrity

| Delivered file | Bytes | SHA-256 |
|---|---:|---|
| `Rebecca_Synthetic_Noncanon_Test.wav` | 398,892 | `6f0473608ab369773cd2b0da304403c3e02918e8a00e4d50e2f75e326284b90c` |
| `Rebecca_Synthetic_Noncanon_Test.mp3` | 101,066 | `36448971ed1f80857acdbf97766fb76f060038b181009d86863ac1ad8dbe30af` |

## Review still required

The crop is attributed to Rebecca by the supplied compilation, context, and the checked English credit. There is no auditory speaker separation or biometric verification. The initial transcript words differed between automatic runs; the current uncorrected ASR text was used for conditioning. Neither transcript is authoritative episode dialogue.

The only rendered preset is `archive_test`. The other three requests explicitly use fallback coverage and remain unrendered. F5-TTS consumes reference audio, text, and rate; it does not execute the character prompts or SSML and cannot guarantee the authored bright, rough, protective, or playful delivery targets.

This test establishes that the packaged profile can condition **new speech** and pass the stated technical checks. A listener must still assess Rebecca likeness, naturalness, soundtrack bleed, speaker purity, articulation, and expressive fidelity. The archive framing and generated line are non-canon; neither credited performer supplied this new performance. Canonical death remains the profile endpoint.


## Circumstance-dependent delivery and measured spectral balance

Revision dated 7 October 2026, following the user’s clarification. **Tone and inflection are circumstance-dependent delivery. Bass–treble balance is a separate recording measurement from fundamental frequency.** Spectral balance can also vary with phonemes, intensity, microphones, soundtrack, mixing, and compression; it is not fixed by one short excerpt.

| Project band | Frequency interval | Reference energy | Generated energy |
|---|---|---:|---:|
| Bass | 20–250 Hz | 21.17% | 0.36% |
| Mid | 250–2,000 Hz | 61.20% | 66.29% |
| Treble | 2,000–8,000 Hz | 12.62% | 32.97% |
| Upper | 8,000–12,000 Hz | 5.01% | 0.38% |

Percentages describe relative spectral power within 20–12,000 Hz over each entire recording. These operational bands are defined for this project and are not universal voice categories. Both analysis copies use 24 kHz, 40 ms Hann windows, a 20 ms hop, mean Welch PSD, and integrated band power. The source and generated audio bytes are unchanged.

The generated recording has substantially less bass-band energy and more treble-band energy by this measure. The comparison uses different words and delivery and includes any residual soundtrack in the reference; it cannot isolate a performer’s vocal spectrum or establish a controlled timbre match. **Spectral agreement remains unvalidated.** The earlier signal and word checks did not test spectral agreement.

`evidence/spectral_balance.json` records input hashes, the method, whole-recording balance, and frame percentiles. Four calibration/conservation checks passed. `evidence/spectrum_revision_checks.json` records 34/34 metadata/provenance checks; these are separate from the retained original 90/90 profile and 15/15 delivery checks. The eleventh source note records this dated refinement. The original render-input reference pack is retained in `history/`; current expression requests and actual generation evidence retain their original hashes.
