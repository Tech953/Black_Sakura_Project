# Engram integration contract

The host engram application owns dialogue generation, memory, user accounts, calendars, daily digests and any API or local GGUF engine. FULL_REZZ supplies audio processing, voice references, speech rendering and authored character context. The animation package supplies an authored performance and a local renderer for its supplied poses. This bridge carries data between them without claiming that these components provide autonomy or neural plasticity.

## Field mapping

| FULL_REZZ input | Bridge output | Host behavior |
| --- | --- | --- |
| `pack_id` + `profile.id` | Stable namespaced `engram_key` | Bind to an existing host character by explicit user/host mapping; keep original IDs |
| `character` | `authored_character`, unchanged `profile_snapshot.character` | Preserve biography, incarnation, demographics, statistic units/editions, persona, prompts, canon notes, archive contract, delivery notes and endpoint |
| `sources` + `character.field_sources` | `source_evidence` plus original attribution | Treat imported source documents as evidence; preserve source dates, review status, original bytes and hashes |
| `references` | `profile_snapshot.references` | Show waveform/reference playback, source interval, quality and review status; do not infer identity from an anonymous label |
| `character_context` | Original context paths in snapshot | Keep prompts as authored data; apply the host's prompt policy explicitly |
| `recordings` | `recording_snapshots` | Retain speaker assignment and origin; imported IDs may have a separately recorded remapping |
| Render `receipt.json` + two WAVs | `inspect_render()` result | Verify hashes, bind the correct profile, preserve review history; mark listening pending when appropriate |
| Authored action descriptor | `action_plan()` result | Play its verified media; keep speech offset and frame grid; disclose that no new poses were generated |
| Unknown extension fields | Full `profile_snapshot` | Preserve them through storage and re-export instead of silently dropping them |

The old supplied pack uses `voice_57373fea79f3473e`. The actual 2.0 import test remapped it to `voice_fbf8403488b7438b`. The latter ID appears in the actual render-receipt evidence. Do not attach that receipt to the original ID merely because the names match. The import evidence records the mapping. The demonstration continues to use the original pack ID.

## Python use

```python
from full_rezz_bridge import ReferencePack, inspect_render, action_plan
from full_rezz_bridge.contracts import read_json

pack = ReferencePack("examples/rebecca_reference_pack")
profile_id = pack.profile_ids[0]
context = pack.to_engram(profile_id)
request = pack.request(profile_id, "The offline archive is ready.",
                       style="concern", steps=32, seed=42)
# Store context via the host's existing character extension mechanism.
# Send request["body"] only to a trusted local FULL_REZZ worker or loopback job API.
plan = action_plan(".", read_json("examples/rebecca_action.json"), profile_id)
```

`ReferencePack` reads a known, extracted reference-pack directory. It does not extract arbitrary ZIP uploads. Use the original application's transactional portable importer for untrusted ZIPs. That importer rejects traversal, reserved Windows names, case-insensitive duplicates and symlinks; limits expanded input to 512 MiB/10,000 entries; validates clips/sources; remaps IDs; rolls back failed imports; preserves the original ZIP for exact re-export.

The portable bridge requires declared hashes for reference audio and source files. A legacy pack without hashes must be re-exported or explicitly migrated with provenance before use. Context/prompt/log hashes without declared checksums are observed byte hashes, not authenticated provenance. Matching checksums prove byte consistency; they do not prove source truth, identity or perceptual quality.

The bridge reads JSON up to 8 MiB by default. Speech output is limited to 500 characters per request, separately from character JSON size. Do not lower an existing host's upload limits or split a character's lore into the speech limit. Keep text/reference errors visible and preserve the original uploaded file.

## Worker boundary

`full_rezz_bridge.local.LocalRuntime(app_root, project_root)` loads FULL_REZZ 2.0 code from the chosen application directory, activates the existing offline guards before heavy imports, obtains the application's project lock, and delegates `render`, `review` and `import_pack` to the implemented application functions. The lock prevents simultaneous GUI and worker writes to one project. User data must stay outside the application directory.

Run this backend as an isolated process with the installed bundled interpreter, or package it with the host's offline runtime. Keep the worker's working directory at the bridge package root. A Windows shell example after incorporation is:

```bat
"%LOCALAPPDATA%\Programs\FULL_REZZ\runtime\python.exe" -m full_rezz_bridge local-render --app-root "%LOCALAPPDATA%\Programs\FULL_REZZ\app" --project-root "C:\EngramData\VoiceProject" --request "C:\EngramData\request.json"
```

The default embeddable interpreter isolates its path. Its `python313._pth` must include the packaged bridge directory for this example to work; add that during the host's build and verify imports. The frozen installer currently includes only the desktop application, so do not claim this additional bridge is already present. Alternatively invoke a host-owned worker entry file after explicitly adding its packaged module directory. Do not require users to install another Python or Node runtime.

Keep requests serialized and show job progress/cancellation state in the host. Review is an append-only annotation on hash-checked audio; it does not train a model. Do not activate the offline guards in the Replit server process, proxy its localhost endpoint to the public internet, or send its CSRF token to a cloud client.

## Authored action playback

The example descriptor has 60 fps, 720 frames, a 12-second duration, speech onset at 1.25 seconds/frame 75, and 23 distinct scheduled drawings. Voice bytes are the pre-existing demonstration statement. `action_plan` validates metadata and hashes; the independent animation audit validates decoded media and PCM timing.

Newly rendered speech is a separate asset. Playing it over this movie is not a new synchronized character performance. A new action requires authored or otherwise implemented animation assets and a new timeline, followed by raster/export/perceptual review. Frame rates above 60 are accepted by the descriptor contract up to 240 fps; the delivered export is 60 fps. The full character export is 60 fps; a separate synthetic 0.5-second fixture was encoded at 120 fps. Full 120/240 fps character performance remains unmeasured.

## Render/audit extension

Use `full_rezz_render.pipeline.process()` in a separate trusted offline worker. It uses source-contained assets, a rational exposure clock, PyAV encoding and exhaustive raster/audio checks, then releases the temporary full-resolution reference. Surface audit coverage and artistic flags to the host; do not upgrade voice review or train from audit feedback. The code is an optional 2.2 source extension and is not inside the frozen 2.0 installer. See `RENDER_AUDIT_GUIDE.md` and the updated incorporation query.

## Optional geometry/continuity source 2.2

Adds orthographic/perspective wireframe projection, strict authored-layout JSON and four additional continuity checks. All 720 existing movie frames passed, including 1,440 projected boot/matte observations and three background regions. Source tests: 84 passed. Open `animation/layout_review/FULL_REZZ_Scene_Continuity_Review.html` for witness overlays; read the guide for `layout` and optional automatic `process()` review. The scene is a flat image-plane guide, not recovered game CAD. Movie/player/voice bytes, the original 12-check audit and 32 artistic flags remain unchanged. The frozen installer has not been rebuilt or run on Windows.
