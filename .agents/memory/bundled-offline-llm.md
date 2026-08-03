---
name: Bundled offline LLM (desktop)
description: How the desktop app ships a built-in llama.cpp model server for zero-setup offline mode, and the non-obvious constraints.
---

The desktop app's "bundled" LLM mode spawns a llama.cpp `llama-server` shipped in `resources/llama/` (bin/ + model.gguf) and points the embedded api-server at it via `LLM_BASE_URL` — chat/analysis/simulation run fully offline with zero setup.

**Rules & gotchas:**
- Staging comes from a gitignored repo-root `.llama/` cache (model: Qwen3-4B-Instruct-2507 Q4_K_M, Apache 2.0, ~2.4 GB; llama.cpp prebuilt release binaries). `LLAMA_TARGET=win32` cross-stages Windows binaries from Linux. Missing cache degrades gracefully — build succeeds without a bundled model and the app falls back to external-local-server mode.
- Only `llama-server(.exe)` + shared libs are staged — release archives contain a dozen CLI tools that bloat size and widen macOS signing surface. llama-server must be listed in `mac.binaries` for notarization.
- Spawn with `cwd` = the bin dir or DLL/.so resolution fails. On NixOS workspace testing, `LD_LIBRARY_PATH` must point at a gcc-lib store path for `libgomp.so.1`.
- Lifecycle: llama startup is transactional (spawn error/early exit rejects → kill + fall back to offline settings); it must be stopped on quit AND in the auto-update install path, or a multi-GB orphan survives the update.
- Model load takes 1–3 min; wait on llama `/health` == ok BEFORE starting the api-server, else engine ticks log 503 "Loading model".
- LAN access for the mobile app is opt-in (`allowLan` setting → HOST 0.0.0.0); llama itself always binds loopback. Mobile has a persisted AsyncStorage server-URL override (origin-only http(s), normalized), applied before splash-hide so first queries hit the right server.

**Why:** the app must fully emulate online mode with no user setup (user requirement); a first attempt that spawned llama non-transactionally leaked processes across updates (code review finding).

**Workspace quirks:** /tmp has a ~32 GB quota — stage multi-GB downloads under the workspace, not /tmp. `wget -c -O file` does NOT resume (use natural filename); electron-builder's final zip step of a ~2.7 GB app exceeds a 300 s shell window — zip `release/win-unpacked` manually instead.
