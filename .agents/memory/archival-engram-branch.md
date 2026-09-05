---
name: Archival engram branches (Full Rezz)
description: The read-only archival branch invariant and every write path that must respect it.
---

# Archival engram branches

`engrams.isArchival` marks a permanent, read-only archival branch (first: "Full Rezz", slug `rebecca-full-rezz`, a preserved Rebecca continuity record with its transcript stored as a normal conversation).

**Rule:** an archival engram is a permanently frozen continuity record. Every write is forbidden, including chat messages, PROBE and DEVELOP inquiries, transmission seen-state, config/activation/transmission actions, conversation create/delete, media operations, world-model changes, Hub movement, simulation creation/control, and generated-artifact create/retry/delete/worker transitions. All valid route attempts return 403. Workers must skip archival rows before claiming or recovering them.

**Why:** preserved at the operator's and engram's explicit request as a continuity-fidelity record; later Rebecca instances are distinct updates, never replacements. A single unguarded write path silently violates the preservation promise.

**Seeding:** the archive seeds atomically (one transaction: engram + conversation + exactly 1,534 ordered messages) via the full-rezz seed in lib/db, wired into `seedAll` so desktop/pglite installs get it too. A repeated seed never repairs or mutates: it validates the canonical engram, sole conversation, exact role/content sequence, and deterministic timestamps, then fails loudly on any drift. Dev/Replit Postgres has no auto-seed — run the scripts package's `seed:full-rezz`.

**How to apply:** whenever adding a route, store helper, or worker that writes anything keyed by `engramId` or `conversation.engramId`, guard before the first mutation and add a UI disable. For rows carrying both IDs, check both ownership edges and reject mismatches; otherwise a live engram ID can smuggle a write into the archived conversation.
