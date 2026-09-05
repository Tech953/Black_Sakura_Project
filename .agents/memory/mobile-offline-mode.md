---
name: Mobile on-device offline mode
description: Non-obvious constraints of the phone app's self-contained offline mode (local handler seam, safety single-sourcing, backend-scoped state).
---

# Mobile on-device offline mode

- **Single choke point:** all generated hooks route through `customFetch`; offline mode registers a `setLocalHandler` seam there that intercepts relative-path requests before base-URL resolution. Chat SSE is the one exception — it streams from the local llama.rn model directly.
- **Custom server URLs:** generated online requests follow Settings through `setBaseUrl`; raw online streams must resolve the persisted server URL when each request starts, never from a module-level build-domain constant. Otherwise a new desktop/LAN address does not take effect until restart.
- **Safety single-sourcing:** persona prompts + HARD_SAFETY + the intimacy≤1 expression filter live in `@workspace/engram-core`; the api-server keeps re-export shims. Never fork prompt logic into the mobile app — offline must stay verbatim-identical to the server's safety boundary.
- **Why:** the task's critical constraint was that intimate expressions can never reach any chat prompt, online or offline; two copies would drift.
- **Backend-scoped client state:** conversation IDs are meaningless across backends. The conversation map keys are mode-prefixed (`off:<engramId>`), and the react-query cache is cleared on mode toggle. Any new client-side ID cache must follow the same rule.
- **Seed data for non-Node runtimes:** raw persona seed lives in a module with a type-only schema import (exported via a dedicated package export) so Metro can bundle it without pg/pglite.
- **Bundled archival records:** keep canonical persona/transcript data in a pure shared module. Dynamically import large transcripts only when the local archive is absent; Metro must still bundle them for zero-network use. Seed the archive atomically with non-null sync markers, resolve its existing conversation instead of creating one, and guard both normal writes and forged sync acknowledgements by direct/conversation archival ownership.
- **Qwen3 think blocks:** stream output through a hold-back filter (partial `<think` prefixes withheld, open blocks suppressed until `</think>`); token fragmentation otherwise leaks reasoning.
- **Offline REST contract parity:** validate real local-store serializer output through the generated API Zod schemas; mocks that return pre-shaped valid bodies can hide drift in nullable fields and enums.
- **Per-request language wins:** when a valid chat/inquiry body supplies a language, use it directly. Resolve the device reply-language preference only when the request omits language.
- **Optional conversation context is durable:** API-supported persona/custom-context fields must be persisted in local SQLite with idempotent upgrade columns, not accepted and silently discarded.
- **Expo download resume:** `createDownloadResumable` + a `.part` file alone cannot resume; you must persist `savable().resumeData` (AsyncStorage) and reconstruct `DownloadResumable` with it, accepting HTTP 206.
- **Metro watcher trap:** after installing packages while the expo workflow runs, Metro can crash with ENOENT watching a vanished `*_tmp_*/local-maven-repo` dir inside `.pnpm`. Fix: clear `/tmp/metro-*` caches and restart the workflow.
