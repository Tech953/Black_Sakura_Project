---
name: Bundled offline LLM (desktop)
description: How the desktop app ships a built-in llama.cpp model server for zero-setup offline mode, and the non-obvious constraints.
---

The desktop app's "bundled" LLM mode spawns a llama.cpp `llama-server` shipped in `resources/llama/` (bin/ + model.gguf) and points the embedded api-server at it via `LLM_BASE_URL` — chat/analysis/simulation run fully offline with zero setup.

**Rules & gotchas:**
- The fixed llama.cpp runtime is a separate trust boundary from any model. Release builds download a pinned archive, verify its SHA-256, re-extract the exact version, and stage only that verified runtime; never accept an arbitrary cached `llama-b*` directory.
- **Windows release policy:** the browser-downloadable build intentionally omits the default GGUF and must remain below 300 MiB, but it still ships the small trusted llama.cpp runtime so app-managed custom GGUFs work. Both local and CI release paths must set slim mode explicitly and enforce runtime-present/model-absent plus the size ceiling.
- Only `llama-server(.exe)` + shared libs are staged — release archives contain a dozen CLI tools that bloat size and widen macOS signing surface. llama-server must be listed in `mac.binaries` for notarization.
- Spawn with `cwd` = the bin dir or DLL/.so resolution fails. On NixOS workspace testing, `LD_LIBRARY_PATH` must point at a gcc-lib store path for `libgomp.so.1`.
- Lifecycle: llama startup is transactional (spawn error/early exit rejects → kill + fall back to offline settings); it must be stopped on quit AND in the auto-update install path, or a multi-GB orphan survives the update.
- Model load takes 1–3 min; wait on llama `/health` == ok BEFORE starting the api-server, else engine ticks log 503 "Loading model".
- User GGUFs live in owner-only app user-data storage, never resources. Copy, fingerprint, and verify them before launch; stop the API before llama changes; persist provider/model settings only after llama and the restarted API are healthy, otherwise restore the prior runtime.
- LAN access for the mobile app is opt-in (`allowLan` setting → HOST 0.0.0.0); llama itself always binds loopback. Mobile has a persisted AsyncStorage server-URL override (origin-only http(s), normalized), applied before splash-hide so first queries hit the right server.

**Why:** bundled mode can fully emulate online mode with no setup, but embedding the 2.4 GB model makes the Windows browser download impractical; process ownership and shutdown ordering are required to prevent orphaned runtimes across updates.

**Workspace quirks:** /tmp has a ~32 GB quota — stage multi-GB downloads under the workspace, not /tmp. `wget -c -O file` does NOT resume (use natural filename); electron-builder's final zip step of a ~2.7 GB app exceeds a 300 s shell window — zip `release/win-unpacked` manually instead.

## Cross-platform packaging lessons
- llama.cpp Linux releases ship soname symlink chains (`libX.so -> .so.0 -> .so.0.N`); naive recursive/dereferencing copies choke on them — resolve to the real file when staging.
- When cross-packaging a Windows desktop build from Linux, EVERY platform-specific binary (llama server, ffmpeg, ffprobe) must be the Windows one, named `.exe`; a build that silently falls back to host-OS binaries ships a broken app. Fail the build if a target binary can't be sourced.
