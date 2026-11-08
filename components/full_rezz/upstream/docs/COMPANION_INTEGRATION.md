# FULL_REZZ 3.0 companion integration

Use the implemented 1.0.0 companion protocol for conversation and visuals. The older bridge action descriptor remains versioned separately and retains automatic_reanimation=false; its inspection run is not live inference. Character asset schema: schemas/full-rezz-character.schema.json. The older draft is historical.

The host repository has not been supplied. This handoff does not claim to have modified ENGRAM. Preserve existing language settings, API/local model selection, profile IDs, user extension fields and stored history when incorporating it.

## Embed the shared core

Add FULL_REZZ/app to your Python module path. Create voice_studio.engine.Studio with a workspace outside the installed application. Create full_rezz_companion.ConversationSession with that Studio. A real reply_provider accepts a list of role/content dictionaries and returns a nonempty string or {"text": "...", ...}; a speech_adapter accepts (profile_id, text, settings) and returns {"audio_path": "actual mono PCM16 WAV", ...}. Do not substitute a fixture or prerecorded lookup for a successful generated turn.

```python
from voice_studio.engine import Studio
from full_rezz_companion import ConversationSession

session = ConversationSession(Studio(workspace), reply_provider=host_dialogue,
                              speech_adapter=host_local_speech)
result = session.reply(profile_id, user_text, {
    "reply_language": "auto", "synthesis_language": "en", "speak": True
})
```

Omitting the adapters uses the actual bundled Qwen2-family local text provider and local speech renderer when verified models/runtimes are available. Source-only Replit imports do not contain those large weights. An mmproj GGUF is rejected. Other text model families need a host adapter with the correct tokenizer/template.

The SDK defaults to isolated local speech workers so offline voice restrictions do not disable a host's API client. The standalone desktop applies offline restrictions inside its own process and workers. Run inference in a host background task; do not block the UI thread. The native application worker uses a Windows kill-on-close Job Object for descendants; Windows behavior is an acceptance gate.

## Embed or open a window

The same full_rezz_companion.qt.CompanionWidget backs the native panel and detached window. Pass the shared Studio, settings_callback, and job_callback(operation, args). Implement that callback using your host's asynchronous runner; pass the saved result into widget.handle_result(operation, result) on the GUI thread. Registered callback presence alone does not prove that it runs.

Supported operations: companion_reply, companion_speech (retry an existing turn), companion_import, companion_character, companion_export. voice_studio.worker.run accepts {workspace, operation, args}; its module CLI also takes result_path. Run it in an isolated subprocess where appropriate. The standalone Window contains the working QProcess runner, cancellation and result handling; reuse it as an example, rather than inventing an unimplemented service.

The widget reads the same SQLite history and character registry in both presentations. Set a unique presentation_source per presenter; only the requesting window plays returned audio. Changing views never changes the profile/voice/history binding. The panel displays 200 recent messages while preserving all accepted history. Source schema validation and runtime asset decoding both apply.

## Import, render and preserve evidence

ConversationSession.import_history(profile_id, path, mapping) accepts the documented JSON/JSONL/CSV/reviewed-text formats. HistoryStore.export writes the complete stored archive and provenance. CharacterRepository.import_pack binds a checked character ZIP to an existing profile. Unknown extension fields remain intact; original imported bytes, hashes and source fields are retained. Model-context limits constrain retrieved excerpts, not stored history.

full_rezz_companion.exporter.export_movie accepts session, profile ID, mode, view ID, clip index, authored action, fps, output .webm path and optional turn_id. It encodes and fully decodes the generated video to check frames and increasing timestamps; a selected speech turn must belong to that profile. 2D shares the panel's painter; 3D shares geometry/shot timing with an independent CPU depth renderer. Export is separate from live GPU performance. It does not create missing anatomy, unseen views or new voice weights.

Keep voice audits, failed speech attempts and five listening ratings separate from render timing, geometry flags and human art approval. Never mark all ratings acceptable just because an ASR check passed. Archived legacy HTTP tests/2.0 interfaces are historical; the current 3.0 native suites and SDK are the active interface. The old direct LocalRuntime bridge supports native 3.0 generation but rejects unsupported legacy overrides and uses native reviewed workspace/reference workflows for 3.0 imports.

## Source environment and import reference

Use Python 3.11+ for the companion/native modules; the default console starter is dependency-free Python 3.10 inspection only. Current Replit ZIP import limit and import behavior were checked against https://docs.replit.com/build/import-from-providers on 14 October 2026. Actual signed-in import/execution has not been performed.
