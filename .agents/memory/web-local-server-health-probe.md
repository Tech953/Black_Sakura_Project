---
name: Web local-server health probe
description: Rules for checking a desktop-hosted ENGRAM server from the web Settings page
---

The web Settings page stores only an origin-only local server URL and probes its unauthenticated `/api/healthz` endpoint with credentials omitted and a short timeout. The API server must expose CORS `*` for that health response while retaining credentialed origin allowlisting for account routes.

**Why:** A hosted browser cannot infer whether a desktop engine is running, and local-server checks must not expose credentials or local file paths.

**How to apply:** Treat blank configuration as a safe “not configured” state; normalize/reject paths, query strings, fragments, userinfo, and non-HTTP(S) URLs; never change the web app’s primary API base URL just to perform the probe.