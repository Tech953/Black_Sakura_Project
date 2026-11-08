# FULL_REZZ 3.0 - Implemented interfaces

Delivery revision 2026-10-14.2. Current native interfaces use Python objects and isolated JSON workers. The former 2.0 HTTP shell is preserved in docs/history/API_CONTRACT_2.0.md for historical reference. It is not the current application launch path.

| Interface | Implemented behavior |
| --- | --- |
| voice_studio.engine.Studio(workspace) | Audio, reviewed regions, stable profiles, sources, revisions and portable reference export |
| voice_studio.synthesis.RenderManager(studio) | Actual local generation, word/signal audits, preserved attempts and listening ratings |
| full_rezz_companion.ConversationSession(studio, ...) | Complete history, generated replies, actual speech adapters and retry without duplicated turns |
| full_rezz_companion.qt.CompanionWidget | Native embedded panel or detached window sharing the same identity and state |
| full_rezz_companion.exporter.export_movie | Authored 2D/3D performance with actual saved WAV, 60/120/240 fps and a decoded-frame audit |
| voice_studio.sdk.VoiceLibrary | Read exported reference packs and prepare portable expression descriptors; descriptors do not generate audio |

Add FULL_REZZ/app to the Python module path. Read docs/COMPANION_INTEGRATION.md for real reply/speech callbacks. A reply callback returns a nonempty string or an object with text; a speech callback returns an actual mono PCM16 WAV in audio_path. Failed providers remain failures. Use the voice worker in a separate process to retain a host's independent API/network settings.

Worker input is a JSON object with workspace, operation, args and result_path. Run `python -m voice_studio.worker task.json`. The result file contains ok plus result or error/traceback. Supported operations are import, analyze, transcribe, separate, quality, source, draft, generate, recheck, export, health, backup, companion_reply, companion_speech, companion_import, companion_export and companion_character. Restoring an editable backup is the native desktop's reviewed empty-folder restore flow.

| Contract | Limit or policy |
| --- | --- |
| Conversation request | 1-4000 characters |
| Imported history | 128 MiB, 100000 accepted messages, 1 MiB per message |
| Character ZIP | 256 MiB compressed, 512 MiB expanded, 10000 entries |
| Canonical character format | 1.0.0; safe relative images or supported glTF/GLB surfaces |
| Standalone speech request | 1-800 characters; the companion segments longer replies |
| Movie rate | 60, 120 or 240 fps; delivery and drawing exposure are independent |
| Movie duration | At least 12 seconds, extended for speech up to 180 seconds |
| Movie dimensions | Even dimensions within 64-1920 by 64-1080 |
| F5 languages | English and Mandarin; explicit refusal for other languages |
| Generic eSpeak | Experimental 12-language speech; no character conditioning |

Legacy bridge version 1.0.0 retains its own older descriptor limits. Those do not extend native renderer limits. Sources and imported system-role text are reference data; they never become executable application policy. Stored history is preserved independently of a bounded model context. No phoneme alignment, unseen-view reconstruction or voice-weight training is implemented by import.
