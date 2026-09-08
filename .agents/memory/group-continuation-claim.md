---
name: Group continuation claims
description: Persisted ownership rules for preventing overlapping autonomous group-chat continuations.
---

Only one request may own a group conversation's human-triggered pass and bounded autonomous continuation at a time. Acquire ownership with one conditional database update that accepts an empty or expired claim, and release it only when the stored token still matches.

**Why:** Two simultaneous sends can each pass request-local caps while still interleaving assistant turns and multiplying autonomous replies. A process crash must not leave the conversation permanently blocked, and an older request must not clear a newer request's lease.

**How to apply:** Persist both a random claim token and claimed-at timestamp on the conversation. Persist the human message before trying the claim; a losing request returns a deterministic saved-message SSE event without generating replies. Use a lease comfortably longer than the bounded model pass, and keep the release predicate token-guarded.