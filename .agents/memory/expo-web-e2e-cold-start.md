---
name: Expo web E2E cold start
description: How to distinguish a cold Expo web bundle timeout from an application regression.
---

The first authenticated Expo web browser run can finish bundling while Chromium still shows only the static root and has no requests or runtime errors. A second run after Metro's cache is warm can render normally without code changes.

**Why:** The native export UI regression initially timed out at the signed-in card during a cold bundle, then passed on the next run; the existing history regression also passed after the warm-up.

**How to apply:** When the harness reports static HTML, zero requests, and no browser errors after a cold Expo start, retry once before changing application code. Keep the actual test assertion strict after the app renders.