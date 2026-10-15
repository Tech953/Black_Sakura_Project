---
name: Group continuation claims
description: Persisted ownership rules for preventing overlapping autonomous group-chat continuations.
---

Only one request may own a group conversation's human-triggered pass and bounded autonomous continuation at a time. Acquire ownership with one conditional database update that accepts an empty or expired claim, and release it only when the stored token still matches.

**Why:** Two simultaneous sends can each pass request-local caps while still interleaving assistant turns and multiplying autonomous replies. A process crash must not leave the conversation permanently blocked, and an older request must not clear a newer request's lease.

**How to apply:** Persist both a random claim token and claimed-at timestamp on the conversation. Persist the human message before trying the claim; a losing request returns a deterministic saved-message SSE event without generating replies. Use a lease comfortably longer than the bounded model pass, and keep the release predicate token-guarded.

Continuation consent belongs on the conversation, not in request-local state. Map the persisted mode to a server-owned turn limit (`off`, `short`, or `extended`) and keep the extended value at the absolute hard cap.

**Why:** A client-supplied number or a UI-only preference can bypass the autonomy boundary, while a persisted mode survives reloads and makes the user's consent auditable.

**How to apply:** Validate the mode through the API contract, default legacy/missing rows conservatively, and never let the stored mode raise the server maximum.

After emitting an autonomous SSE event, yield once before starting the next bounded turn so a client disconnect can reach the server even when the model adapter resolves immediately.

**Why:** Immediate test adapters can otherwise run the entire continuation cap before the socket-close event is processed, masking the disconnect boundary and allowing unnecessary turns.

**How to apply:** Keep the yield inside the request-scoped continuation loop, after the event is emitted and before the next loop guard checks response state.

Before persisting an autonomous turn, check the response again after model generation. A disconnect can happen while generation is awaiting, so checking only before generation can still save a peer reply the user stopped.

**Why:** The stop action closes the client stream immediately, but model adapters may resolve later; persistence must honor that disconnect boundary even when generation cannot be cancelled.

**How to apply:** In the continuation loop, discard the generated response when the response is destroyed or ended, and cover the race with a delayed browser or route fixture.