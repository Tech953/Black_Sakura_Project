---
name: Production preview auth readiness
description: Clerk production-mode previews may redirect HTML requests through a frontend API handshake before browser authentication.
---

Use the credential-free API health endpoint to determine whether a single-port production preview is ready. Do not use an unauthenticated HTML route as the readiness probe: Clerk can return a 307 handshake redirect there, even when the static bundle and server are healthy.

**Why:** The redirect is part of the real Clerk browser flow, not a server-start failure; following it from a non-browser probe can loop or obscure the actual preview state.

**How to apply:** Start the API-backed built frontend, probe `/api/healthz`, then let Chromium exercise the sign-in handshake and authenticated routes.