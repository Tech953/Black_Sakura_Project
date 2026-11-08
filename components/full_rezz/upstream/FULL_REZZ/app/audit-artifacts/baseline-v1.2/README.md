# Voice Profile Studio

**Audited release 1.2.0.** See `AUDIT.md` for findings, measured audio results, and remaining verification limits.

A local program that turns recordings, character research, persona information, and voice logs into a portable audio dossier. It has a browser interface, command-line tools, and a small Python integration interface.

This download is a runnable source project with Windows launchers, **not a compiled `.exe` installer**. Python and the base requirements are needed. No model weights are bundled.

## Start on Windows

1. Extract this entire folder to a location you can write to.
2. Install **64-bit Python 3.11 or 3.12** from [python.org](https://www.python.org/downloads/windows/) if it is not installed.
3. Double-click **Setup_Windows.cmd**. It installs the base requirements and runs the core checks. Keep the folder together.
4. Double-click **Start_Windows.cmd**. Your normal browser opens the local app. Keep its console window open while working.

If the browser does not open, copy the `http://127.0.0.1:...` address printed in the console into the browser. Startup errors remain visible in the console.

Base features work without AI model downloads: audio import, preview, manual regions, physical channel extraction, named profiles, research documents, character authoring, acoustic measurements, and export. Package installation needs internet once. Character web research needs internet when requested.

On macOS/Linux, install Python 3.11/3.12 and run `sh start.sh`, or:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m voice_studio serve --port 0
```

## Build a voice and character dossier

1. **Import audio** in Recordings. WAV, MP3, FLAC, M4A, OGG, and other listed formats are supported through PyAV or FFmpeg. The original file is preserved locally.
2. Choose a processing mode. **One voice reference recording** declares that the recording contains one voice and gates acoustic activity. **Separate physical channels** lists activity on each channel independently. **Automatic speaker detection** uses the optional diarization model.
3. Review the speaker regions. Adjust start/end times, speaker labels, channel, sample style, review status, and transcript/voice-log text. A region marked **Unreviewed** is kept as an annotation but excluded from clean references. Save edits.
4. Create a named character/voice and **assign speaker tracks** to it. Labels such as `SPEAKER_00` are local to a recording; assigning the same named profile across recordings is how you establish cross-file identity. The app does not silently identify people across recordings.
5. In **Characters & voices**, add the biography, demographic fields, statistics, persona, and prompts. Demographics are supplied/sourced facts, never guesses from a voice. Keep units, system/edition, and source context with statistics.
6. Search a character name using Wikipedia/Wikidata, attach the exact matching source, add a public URL, or import your own canon. TXT, Markdown, JSON/JSONL, CSV/TSV, HTML, DOCX, and text-based PDF are supported. The original imported document and extracted text are retained and exported.
7. **Draft dossier from attached sources** fills empty fields from explicit Wikipedia/Wikidata data and character JSON. It preserves authored canon and reports conflicts. This is source extraction, not an LLM; prose documents remain searchable evidence, and unstated persona traits stay unknown. Review and save the draft.
8. Cite sources using the **field-to-source map**. For Wikidata, individual source claims can be added to demographic/statistic fields with their raw values, qualifiers, and source IDs.
9. In **Audio quality & non-destructive cleanup**, compare original and cleaned previews, measure the selected signal, and save any cleanup settings. See the audio-quality workflow below.
10. **Export all profiles**. The resulting ZIP links character information and prompt files with audio references, acoustic measurements, transcripts, and voice logs.

The synthetic demo uses two test-tone channels, not human speech. It demonstrates extraction, pitch measurement, profile linking, and export. It is not a diarization/transcription accuracy test.

## AI tools

Install each optional backend separately in a command window opened in this folder, or run Setup_AI.cmd and enter its name.

| Capability | Install | Processing |
|---|---|---|
| Automatic speaker regions | `Setup_AI.cmd diarization` | pyannote Community-1, CPU |
| Speech transcription | `Setup_AI.cmd transcription` | faster-whisper, CPU `int8`, default `small` model |
| Overlapping two-speaker estimates | `Setup_AI.cmd separation` | SpeechBrain SepFormer, CPU, 8 kHz, excerpts up to 30 seconds |

Real faster-whisper **tiny.en CPU/int8 transcription** and SpeechBrain **SepFormer two-source inference** passed the audit on generated speech, including the browser workflow. Community-1 diarization inference remains unverified because its gated model access was unavailable. The default `small` transcription model and real-world recordings were not benchmarked. Install/model errors are explicit and do not produce invented results or change processing modes.

For Community-1, review and accept the [model access conditions](https://huggingface.co/pyannote/speaker-diarization-community-1), create a Hugging Face token, and set `HF_TOKEN` in your own shell before starting the program. For example, in PowerShell:

```powershell
$env:HF_TOKEN = "YOUR_LOCAL_TOKEN"
.\Start_Windows.cmd
```

The app does not collect a token through its UI or export it. You can use a previously downloaded model directory by setting `VOICE_STUDIO_DIARIZATION_MODEL` to that path. The transcription model input also accepts a local faster-whisper model folder. Set `VOICE_STUDIO_SEPARATION_MODEL` to a compatible SepFormer repository/path if needed.

Model downloads require network access. After compatible models are cached/provided, processing can run locally. Research searches and source URLs remain separate online actions. Telemetry environment defaults for pyannote and Hugging Face are disabled in the adapter.

SpeechBrain and pyannote can depend on different torch/audio/Hugging Face versions. Run `pip check` after changing optional requirements. The verified combination was faster-whisper 1.2.1, SpeechBrain 1.1.1, torch/torchaudio 2.8.0 CPU, and huggingface-hub 0.36.2. For separation, COPY caching avoids requiring Windows symlink privileges. If they conflict, use separate virtual environments, install the base project plus only one backend in each, and launch the appropriate environment with the **same `--data-dir`**. Close one instance before opening another: project writes are synchronized within a single process, not across independent app instances. The separation requirements constrain torch/torchaudio below 2.9 to retain APIs used by SpeechBrain. Audio decode/shared-library errors may require a matching FFmpeg installation; passing waveform tensors avoids pyannote's file-decoder path but does not remove all import-time dependencies.

All default AI inference uses CPU to avoid assuming CUDA compatibility or available graphics memory. Processing time depends on recording length, model, and hardware. Installed-package badges do not guarantee downloaded models or successful inference.

## What “isolation” means

- A recording/channel/timed-region crop can faithfully isolate a voice **when that selected signal already contains only that voice**.
- Diarization labels who spoke when. It does not remove another voice from a mixed waveform. The app subtracts detected overlapping speaker intervals from reference eligibility on the same signal.
- Different physical channels can be extracted independently. If a channel itself contains multiple voices or bleed, listen and review; channel selection does not remove that contamination.
- Overlap separation creates two estimated anonymous sources. They can contain artifacts, leakage, or identity swaps and need listening/reassignment. The bundled adapter's model was trained for two-speaker WSJ0 mixes and operates at 8 kHz; it is not high-fidelity recovery for every environment.

Untreated references retain background sound. Acoustic activity gating can include music/noise. Speaker review records the basis (`user_declared_single_voice`, `reviewed_single_voice`, or `model_nonoverlap`), not a guarantee of studio-quality audio. Signal quality is checked separately in every exported reference. Re-running detection clears speaker-to-profile bindings because new model labels may be reordered; assign and review the new tracks.

## Audio quality and cleanup

1. Open **Audio quality & non-destructive cleanup** under the selected recording. Choose a channel and a preview interval of up to 60 seconds. Opposite-phase channels may cancel in a mono mix; inspect individual channels if the mix is silent.
2. Use **Measure selected signal** to compare source and output levels, DC offset, possible clipping, and a quiet-frame noise estimate where a usable quiet baseline exists. No quiet baseline means noise is **unknown**, rather than assumed absent.
3. For conditioning, select **Apply the cleanup settings below**. DC removal, a gentle 30 Hz rumble filter, a 5 ms boundary fade, and a -3 dBFS target peak are available. Peak gain is capped at +12 dB. The defaults preserve raw working samples until you enable cleanup.
4. Optional noise attenuation needs a **noise-only interval of 0.1–5 seconds** in that recording. Keep voice and music out of the selected interval. Start with 3–6 dB; the maximum attenuation setting is 12 dB. It uses a bounded spectral gain with phase-preserving reconstruction. Compare the two previews for altered timbre or residual noise.
5. Save settings, compare **Original** and **Cleaned**, then export. Processing is applied separately to each reference clip at its source rate and records the exact sample offsets. Source recordings and decoded arrays are untouched. A preview with different crop boundaries can differ slightly from a final clip's filter/fade result; inspect the exported WAV as well.

**High-fidelity screening**, the default, excludes silence/DC-only clips, likely full-scale clipping, output over-range audio, and sources below 22.05 kHz. That rate is this app's screening threshold, not proof of high fidelity. **Standard screening** allows reviewed low-rate sources but still excludes damaged/silent output. The SepFormer adapter outputs 8 kHz estimates; those require Standard screening and listening review and cannot be restored to high fidelity by upsampling.

Cleanup can reduce selected noise, rumble, clicks at crop boundaries, and DC offset. It cannot restore clipped information, certify speaker purity, remove every background sound, or verify perceptual quality. Every reference retains `listening_review_required: true`. A pack with zero references remains a dossier with an exclusion report; expression requests refuse to pretend it contains usable voice audio.

Source/output quality checks, encoding, quantization measurements, and processing provenance appear in `manifest.json` and `quality_report.json`. The SDK validates reference hashes and prefers better signal quality and bandwidth before style matching. Overlapping ASR words stay ambiguous even when one speaker dominates the timing.

## Export contents

| File | Contents |
|---|---|
| `manifest.json` | Stable profile IDs; original-file hashes; local speaker assignments; individual reference descriptors; source links; optional model embeddings; completeness counts |
| `clips/*.wav` | Native-rate mono snippets, up to 20 seconds each; default FLOAT32 preserves the decoded working samples when cleanup is off; PCM24/PCM16 are selectable |
| `quality_report.json` | Source and delivered-WAV checks, cleanup settings/steps, included clips, and explicit reasons for excluded clips |
| `characters/<voice-id>/character.json` | Biography, demographics, statistics, persona, authored prompts, canon notes, field citations, and extension fields |
| `characters/<voice-id>/prompt.txt` | Assembled character context with source index for another program |
| `characters/<voice-id>/voice_logs.jsonl` | Manual annotated utterances/style labels and speaker-assigned transcription records, linked to references |
| `sources/<source-id>/` | Full imported original file, complete extracted text, metadata, hashes, extraction warnings, and structured retrieved claims when available |
| `transcript.jsonl` | Word/source-region timestamps, transcription probability when available, speaker assignment method, uncertain/overlapping assignments |
| `segments.csv` | Region annotations, profile assignments, style, review status, and eligible reference duration |
| `<recording-id>.srt` / `.vtt` | Source-time subtitles, per word when word timestamps are available; empty if no speech text exists |

The original **audio** recordings stay in the local workspace and are not bundled into the reference export. Imported character **source documents** are bundled. Both PyAV and FFmpeg retain the source sample rate and decode to float32. Float32 WAV preserves those working samples exactly when cleanup is disabled. PCM24 and PCM16 exports use deterministic triangular dither and the correct signed full-scale mapping. Their measurements describe the delivered WAV after quantization. Higher output bit depth does not restore compressed detail or low source bandwidth. Originals of higher precision remain preserved; the float32 working representation does not retain every bit of 32-bit integer or 64-bit float input.

The program measures pitch estimates, periodicity, RMS/peak levels, clipping, spectral centroid, frame energy, and voiced-frame fraction. Aggregate values describe distributions of clip medians, not pooled frame statistics. Pitch estimation uses a 65–500 Hz autocorrelation search and can fail for atypical pitch, noise, music, or overlap. No emotion, accent, gender, age, clinical quality, or identity is inferred acoustically.

PDF scans need OCR before import. DOCX extraction includes main body/table text; headers, footnotes, comments, and images remain in the retained original. HTML extraction can miss script-rendered material. Wikipedia text extracts may omit tables and formatting. Research claims remain unreviewed; the app does not declare source truth or reconcile different incarnations automatically. Review conflicts before saving a source draft.

## Use from another program

Extract an exported ZIP before loading it. With this project importable:

```python
from voice_studio.sdk import VoiceLibrary

library = VoiceLibrary("path/to/extracted-reference-pack")
voice_id = library.manifest["profiles"][0]["id"]
sample = library.reference(voice_id, style="gentle")

request = library.expression_request(
    voice_id,
    text="The route is clear. We can continue.",
    style="gentle",
    rate=0.95,
    pitch_semitones=0,
    volume_db=0,
)
# request includes the audio path, biography/persona, source context, text,
# prosody, and SSML. Supply these to your chosen synthesis renderer.
```

The expression interface supports sample selection and an utterance request for autonomous/companion programs. It **does not synthesize speech, train a voice model, or make an AI character autonomous**. Speaker conditioning, style control, and SSML support depend on the renderer you connect. A GGUF language model alone is not a voice synthesis renderer. Unknown requested styles fall back to the best screened reference and return `style_match: false`. Browser expression jobs use the selected export encoding and quality policy and provide a download link for the exact reference package used in that request; its relative reference path remains valid after extraction.

Character research is evidence, not executable instructions. The generated prompt identifies source text as untrusted reference material. Authored prompts are only exported; this app never executes them.

## Command line

```sh
python -m voice_studio --data-dir ./my-project import recording.wav
python -m voice_studio --data-dir ./my-project profile "Aster"
python -m voice_studio --data-dir ./my-project list
python -m voice_studio --data-dir ./my-project analyze RECORDING_ID --method pyannote --speakers 2
python -m voice_studio --data-dir ./my-project bind RECORDING_ID SPEAKER_00 VOICE_ID
python -m voice_studio --data-dir ./my-project source VOICE_ID examples/character.json
python -m voice_studio --data-dir ./my-project character VOICE_ID examples/character.json
python -m voice_studio --data-dir ./my-project transcribe RECORDING_ID --model small
python -m voice_studio --data-dir ./my-project quality RECORDING_ID --start 0 --end 10 --channel 0
python -m voice_studio --data-dir ./my-project cleanup RECORDING_ID examples/cleanup.json
python -m voice_studio --data-dir ./my-project export --encoding FLOAT32 --quality-policy high_fidelity
python -m voice_studio expression ./extracted-pack VOICE_ID "Hello." --style gentle --output request.json
```

Use real IDs printed by `list`. Global `--data-dir` belongs before the subcommand. `character` takes a plain character object; source-draft import can also read an engram object with a `character` field. Export accepts repeated `--profile VOICE_ID` to select profiles.

## Project location and limits

On Windows the default project data is `%LOCALAPPDATA%\VoiceProfileStudio`; on macOS/Linux it is `$XDG_DATA_HOME/voice-profile-studio` or `~/.local/share/voice-profile-studio`. Choose a different folder with `--data-dir`. The server binds only to loopback. It is not a multi-user network service. The app and CLI hold an OS lock for the data folder, so a second writer is refused. Direct Studio callers must enforce one writer themselves. Back up the project folder to retain original audio and your authoring history.

Limits: audio uploads up to 250 MiB, 30 minutes/8 channels per recording, 512 MiB decoded float audio; imported source files up to 8 MiB; extracted document text up to 32 MiB; character JSON up to 2 MiB; public source responses up to 2 MiB. Longer lore belongs in source documents. Split recordings for larger projects. One expensive processing task runs at a time.

## Verification

```sh
python -m unittest discover -s tests -v
node tests/test_ui.js
node --check voice_studio/web/app.js
```

See `AUDIT.md`, `VALIDATION.md`, and `audit-artifacts/` for actual checks, measurements, and verification limits. This is version 1.2.0 (reference-pack schema 1.1.0). The SDK also reads 1.0.0 packs. Schemas allow FLOAT_32, PCM_24, and legacy PCM_16 encodings.

Optional browser/schema audit tools:

```sh
python -m pip install -r requirements-audit.txt
python -m playwright install chromium --only-shell
python tests/playtest_browser.py
```

The optional browser playtest uses generated fixtures in `audit-artifacts/`; it does not import your existing project data.

## Upstream interfaces and attribution

- [pyannote Community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1) — diarization, exclusive speaker timeline, offline path support and access conditions; model CC BY 4.0.
- [pyannote.audio](https://github.com/pyannote/pyannote-audio) — 4.x pipeline API, model embeddings, and telemetry controls.
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) — CPU/int8 inference and word timestamps; package MIT.
- [SpeechBrain SepFormer WSJ0-2Mix](https://huggingface.co/speechbrain/sepformer-wsj02mix) — two-source inference at 8 kHz; model Apache 2.0.
- [MediaWiki search API](https://www.mediawiki.org/wiki/API:Search), [TextExtracts](https://www.mediawiki.org/wiki/Extension:TextExtracts), and [Wikibase API](https://www.mediawiki.org/wiki/Wikibase/API) — character search and explicit source collection.
- Wikipedia text uses the article's CC BY-SA terms; Wikidata structured data is CC0. Preserve source links and applicable attribution when reusing exported material.

These upstream references were checked on 2026-10-05. Dependencies and model availability can change; use the version ranges and error reports rather than assuming a package badge proves inference.

## Editing and audit fixes in 1.2

Region and character drafts survive switching items within the current browser tab, including unfinished JSON. Save them before closing the tab; the browser warns about pending edits. Export and expression requests require saved drafts. Cleanup edits must be saved or discarded before switching recordings.

Saves carry the revision originally loaded by the editor. A stale save is rejected instead of replacing newer information. Text typed while a save is in progress remains pending. Source drafts from previous sessions are not replayed into the current editor.

Known persona fields and prompts have validated types, and field citations must identify sources attached to that profile. Invalid imported candidate fields are skipped with reasons. Valid older character objects receive missing defaults during export; stored canon and extension fields are preserved.

Rerunning detection clears assignments and preserves previous recording metadata under `recordings/<id>/history/`. No graphical history-restoration interface is provided. Reassign and review newly detected tracks. Duplicate annotations no longer inflate same-signal reference duration. Eligible, wholly contained ASR words populate reference text and link transcription logs to the matching references.

See `AUDIT.md` for the full findings and `VALIDATION.md` for current checks versus retained prior evidence.
