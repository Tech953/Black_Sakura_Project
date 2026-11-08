# Languages and offline speech

Version 3.0 supports English, Spanish, French, German, Portuguese, Italian, Russian, Japanese, Korean, Simplified Chinese, Arabic and Hindi interface catalogs and in-app workflow guides. The seventh native tab holds four independent language settings plus explicit speech-engine selection. Interface changes apply immediately and persist. Existing workspace and custom settings fields survive migration. Authored dialogue, profile identity, source evidence and prior audits are preserved.

Interface language controls labels and guide text. Reply language is an ENGRAM dialogue contract: Automatic follows the host-confirmed user language rather than the interface locale. The character companion generates local replies. Automatic asks the model to follow the current request; the host should confirm ambiguous languages. The voice editor does not translate dialogue. Transcription language selects Automatic Whisper detection or an explicit language hint. Synthesis language selects the output language of an explicitly chosen engine.

Arabic uses right-to-left layout. JSON, paths, hashes and raw evidence remain left-to-right. Bundled Noto fonts cover CJK, Arabic and Devanagari. The standard installer pages offer twelve languages; legal notices and raw technical details retain their original language. Professional native-language review and actual Windows execution remain pending.

## Engine boundaries

F5-TTS/Vocos remains the reference-conditioned engine for English and Mandarin. Other language requests are rejected before reference export or inference. Changing output language does not change the original reference track, performer attribution, canonical endpoint or source provenance. Chinese output from an English reference is authored approximation, not a Mandarin dub or a verified performer performance.

eSpeak NG 1.52.0 is a separately selected experimental generic engine with bundled data for twelve languages. It does not condition on or imitate the profile's reference. Arabic expects vocalized text; Japanese support is preliminary. Seed, sampling steps and reference-style fields do not control this backend; the audit records them as unused. Input is UTF-8 stdin with fixed arguments, never a shell command. There is no silent backend substitution or dialogue translation.

Standalone test generation prepends localized spoken synthetic/noncanon disclosure by default. Companion conversation records its disclosure in the interface and receipts. Raw samples are retained and conditioned PCM16 is delivered at the native engine rate (F5 24 kHz, generic 22.05 kHz). Text agreement and valid audio do not approve likeness, pronunciation, naturalness or fidelity. Generic audits mark reference comparison and character imitation as inapplicable. Every listening rating starts unreviewed, and failures remain in history.

Chinese and Japanese use CER rather than whitespace-based WER. Unicode word boundaries retain Hindi combining marks and ignore optional Arabic vocalization for comparison. Chinese comparisons use OpenCC 0.1.7 Traditional-to-Simplified characters individually, without phrase or slang replacement. Original expected text, raw ASR transcript, normalized comparison strings and policy remain in each audit. This is orthographic comparison, not a pronunciation judgment.

## Audit and portability

The preserved baseline outcomes are in audit/localization_ui.json, multilingual_audio.json and native_generation_v3.json. Current rebuild receipts are under evidence/rebuild_20261014/. Earlier unsaved v3 tests were removed by maintenance and are not counted as current evidence. The source checkpoint was saved before this rebuild. Signal-valid audio and a supported locale must not be presented as all-language accuracy certification. Native-speaker review remains pending.

Localized workflow guides are under docs/locales/ and shown by the Guide tab. Full English user guide, quick start and audit are PDFs. Global language settings are per-user; generation records snapshot routing settings. Workspace backups retain originals and generation history but do not overwrite global preferences when moved to another computer.

F5 weights retain their noncommercial terms. eSpeak is an unmodified separate GPL-3.0-or-later CLI; its corresponding versioned source accompanies the complete source archive under licenses/corresponding_source. Qt/PySide corresponding sources are also included there. Principal notices are installed. Noto full OFL notices are under fonts/. OpenCC Apache notices remain with its distribution. Source archives are developer resources, not installed-program dependencies.
