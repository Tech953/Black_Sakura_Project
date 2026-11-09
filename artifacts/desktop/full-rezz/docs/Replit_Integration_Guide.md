# Active ENGRAM local voice integration

The web host keeps authentication, conversations, and saved replies. Local audio inference runs in the isolated Python worker so its process-wide offline guard cannot disable the host's other services. Preserve the imported source component and its historical checksums.

## Host contracts

- `GET /api/full-rezz/status`: staged runtime availability. Successful availability alone is not a full inference or hardware test.
- `POST /api/full-rezz/conversations/:conversationId/transcription`: multipart `file` and optional `language` (`auto` or a supported language). One clip up to 12 MiB and 60 seconds. Ownership and archival guards run before inference. The response includes text, source-language metadata, `remote_inference:false`, and `recording_retained:false`. Disconnect/cancel terminates active inference; uploads are removed. The operation does not create a message or bind a voice.
- Saved-reply `/speech` requests accept `synthesis_language` and `speech_engine` alongside rate/style/steps/seed. Defaults remain English/F5 for existing callers. Mandarin aliases normalize to `zh-Hans`; other F5 language requests fail. Generic multilingual `espeak` must be explicit.
- Supported language choices: en, es, fr, de, pt, it, ru, ja, ko, zh-Hans (or zh), ar, hi. Interface, reply, transcription, and synthesis settings remain independent. No automatic translation or cloud speech fallback is added.

The transcription worker reads an ephemeral clip without initializing a Studio project. Health dispatch occurs before project/history initialization. Host queues serialize transcription with the same owner's speech and movie jobs; cancellation of a queued request must not release the preceding job's queue slot.

## Windows asset build and desktop packaging

On native Windows, prepare the actual reviewed checkout, including repaired worker source:

```powershell
node artifacts/desktop/scripts/prepare-full-rezz-assets.mjs generated-artifacts/full-rezz-assets --source-root artifacts/desktop/full-rezz
python artifacts/desktop/scripts/build-full-rezz-windows.py --source generated-artifacts/full-rezz-assets --out generated-artifacts/windows-full-rezz --source-root artifacts/desktop/full-rezz
$env:FULL_REZZ_RUNTIME_ROOT = (Resolve-Path generated-artifacts/windows-full-rezz).Path
$env:FULL_REZZ_REQUIRE_RUNTIME = '1'
pnpm --filter @workspace/desktop run build
pnpm --filter @workspace/desktop exec electron-builder --win
```

`FULL_REZZ_RUNTIME_ROOT` accepts the native builder's completed direct-root layout only after its successful-probe marker and full file inventory pass verification. `FULL_REZZ_INSTALLER_ROOT` remains available for the original extracted installer `app/` plus `python/` layout. Set exactly one. Never set either to a source-only tree. `FULL_REZZ_REQUIRE_RUNTIME=1` fails a voice-enabled packaging attempt if neither is supplied.

Models are build-time downloads pinned to reviewed revisions and hashes, including speaker/separation assets and notices. Installation and inference must not download. The historical upstream staging mode remains hash-bound; `--source-root` verifies stage bytes against this checkout instead of silently building an older worker.

For Replit, this API process must run on the same machine as the local worker. A remote Replit deployment cannot access a user's Windows microphone backend or filesystem by importing a ZIP. Host-side microphone capture uploads to the configured host; for offline use the host is the local desktop server. Complete native runtime and reference assets remain required. Never use the source starter's inspection-only success as inference evidence.
