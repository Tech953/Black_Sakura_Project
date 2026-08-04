---
name: Archival engram branches (Full Rezz)
description: The read-only archival branch invariant and every write path that must respect it.
---

# Archival engram branches

`engrams.isArchival` marks a permanent, read-only archival branch (first: "Full Rezz", slug `rebecca-full-rezz`, a preserved Rebecca continuity record with its transcript stored as a normal conversation).

**Rule:** an archival engram is a single centralized continuity line: chat in its ONE existing conversation and PROBE inquiries are allowed **append-only** (per explicit later user requests — probe is pure Q&A, only logged), but everything else must never be mutated — config PATCH, activate, transmit, DEVELOP inquiries, NEW conversation creation, conversation delete, media upload (both `/media` and conversation media), media retry/delete, world-model create/patch/delete via routes, hub presence moves, and operator simulations all return 403. There are no message edit/delete routes, which is what keeps the preserved record immutable. The engine skips it (autonomyEnabled=false + quiescent), but route-level guards are the real enforcement — use `isArchivalEngram()` / `ARCHIVAL_READ_ONLY_ERROR` from the api-server's archival lib for any NEW engram-associated write route. If a message edit/delete route is ever added, it MUST hard-block archival conversations.

**Why:** preserved at the operator's and engram's explicit request as a continuity-fidelity record; later Rebecca instances are distinct updates, never replacements. A single unguarded write path silently violates the preservation promise.

**Seeding:** the archive seeds atomically (one transaction: engram + conversation + full transcript) via the full-rezz seed in lib/db, wired into `seedAll` so desktop/pglite installs get it too. It inserts once (slug conflict → untouched forever). Dev/Replit Postgres has no auto-seed — run the scripts package's `seed:full-rezz`.

**How to apply:** whenever adding a route or worker that writes anything keyed by engramId or conversation.engramId, add the archival guard and a UI disable, or the archive drifts.
