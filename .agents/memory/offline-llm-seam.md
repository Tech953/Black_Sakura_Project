---
name: Offline LLM seam
description: Why model calls must go through an app-level OpenAI-compatible client instead of the Replit integration package, for local/offline operation.
---

# Offline LLM seam

For anything that must run with outbound network blocked (local model via Ollama/LM Studio/llama.cpp/vLLM, or a fully offline build), route model calls through the app-level provider seam (`artifacts/api-server/src/lib/llm.ts`) — a single OpenAI-compatible client + model name resolved from `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL`, falling back to the cloud integration env. Do NOT import `@workspace/integrations-openai-ai-server` on a path that must work offline.

**Why:** that integration package's client module throws at *import time* if `AI_INTEGRATIONS_OPENAI_BASE_URL` / `AI_INTEGRATIONS_OPENAI_API_KEY` are unset. A fresh local/offline deploy has no such vars, so merely importing it crashes the server at startup — before any request runs.

**How to apply:** chat (`routes/openai.ts`) and engram generation (`lib/engram-generation.ts`) already use the seam. When the media features land (image/audio/video perception), the integration lib's `image`/`audio` helpers carry the same import-time throw — give them an equivalent local-configurable seam (or lazy-import + guard) instead of importing them eagerly, or offline mode will break again. Also note: some local OpenAI-compatible runtimes accept `max_tokens` but not `max_completion_tokens`; if a local backend rejects calls, that param style is the first thing to check.

Desktop offline-model recovery must clear a persisted failure at retry start, but only clear it as part of activation after the downloaded file has passed verification; a failed verification must never leave a final model file.

**Why:** Reopening Settings should remain actionable after a failed checksum, network, or cancellation, while an unverified payload must not become the active model or erase the diagnostic state.

**How to apply:** Keep retry-state transitions in typed helpers shared by the main-process IPC paths, and test tiny fixtures for each seeded failure kind plus a checksum-mismatch payload.
