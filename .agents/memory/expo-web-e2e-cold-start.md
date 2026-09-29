---
name: Expo web E2E cold start
description: How to distinguish a cold Expo web bundle timeout from an application regression.
---

The first authenticated Expo web browser run can finish bundling while Chromium still shows only the static root and has no requests or runtime errors. A second run after Metro's cache is warm can render normally without code changes.

**Why:** The native export UI regression initially timed out at the signed-in card during a cold bundle, then passed on the next run; the existing history regression also passed after the warm-up.

**How to apply:** When the harness reports static HTML, zero requests, and no browser errors after a cold Expo start, retry once before changing application code. Keep the actual test assertion strict after the app renders.

A completed Metro bundle is not proof that a headless browser regression reached the app. A warmed run can still stall without returning an assertion while the managed preview itself starts normally.

**Why:** A focused Hub/Environment run bundled successfully but never produced a terminal signed-in screen result; repeating the same browser route did not resolve it.

**How to apply:** After one cold-start retry, do not launch repeated or parallel mobile browser runs without new evidence. Check the owning workflow and browser output, and report the route-level check as inconclusive rather than changing UI based on a stalled run.