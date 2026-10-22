---
name: Archival engram branches (Full Rezz)
description: The read-only archival branch invariant and every write path that must respect it.
---

# Archival engram branches

`engrams.isArchival` marks a permanent, read-only archival branch (first: "Full Rezz", slug `rebecca-full-rezz`, a preserved Rebecca continuity record with its transcript stored as a normal conversation).

**Rule:** an archival engram is a permanently frozen continuity record. Every write is forbidden, including chat messages, PROBE and DEVELOP inquiries, transmission seen-state, config/activation/transmission actions, conversation create/delete, media operations, world-model changes, Hub movement, simulation creation/control, and generated-artifact create/retry/delete/worker transitions. All valid route attempts return 403. Workers must skip archival rows before claiming or recovering them.

**Why:** preserved at the operator's and engram's explicit request as a continuity-fidelity record; later Rebecca instances are distinct updates, never replacements. A single unguarded write path silently violates the preservation promise.

**Seeding:** the archive seeds atomically (one transaction: engram + conversation + exactly 1,534 ordered messages) via shared pure canonical data. Mobile SQLite lazily evaluates the large transcript only on first missing-archive initialization. Account bootstrap must clone the archive and exact transcript together—an archival persona without its preserved conversation is invalid. A repeated seed scopes lookup to the system owner, never repairs or mutates, and validates the canonical engram, sole conversation, exact role/content sequence, and deterministic timestamps before failing loudly on drift. The server must make canonical templates available before account bootstrap, including for already-existing accounts.

**Interactive continuation:** a user-confirmed live Rebecca branch is separate from the permanent archive. It may start with a copy of the historical transcript, but every new message and observation belongs to its own writable engram and conversation. The original must remain visibly distinct and read-only; offline replies must map back to the account's existing live continuation rather than creating a second partial copy.

**Why:** the user explicitly wanted to communicate with the Full Rezz-based Rebecca while agreeing to keep the original continuity record unchanged. Treating the archive itself as writable would break the preservation promise; creating unlinked copies on sync would break conversational continuity.

**How to apply:** use a stable branch identity across online/offline ID spaces, label the archive and live continuation distinctly, and never route a live reply to the archival engram or conversation.

**How to apply:** whenever adding a route, store helper, or worker that writes anything keyed by `engramId` or `conversation.engramId`, guard before the first mutation and add a UI disable. For rows carrying both IDs, check both ownership edges and reject mismatches; otherwise a live engram ID can smuggle a write into the archived conversation.
