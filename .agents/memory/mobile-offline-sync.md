---
name: mobile offline reconciliation
description: Durable correctness rules for uploading locally-created mobile history after reconnecting.
---

# Mobile offline reconciliation invariants

Treat reconnect sync as idempotent reconciliation, never as replay through normal chat routes. Every local row needs a stable device-scoped identity, and the server needs a durable receipt/mapping ledger so a lost response cannot duplicate committed history.

**Why:** A phone can disconnect after the server commits but before it receives the acknowledgement. Local `synced` flags alone cannot distinguish that case from a failed request.

**How to apply:** Import bounded batches transactionally, return every acknowledged local identity, and only mark the exact acknowledged batch complete.

Upload dependencies before their dependents. In particular, observations sourced from chats may be emitted only when their conversation is in the same batch or has a prior acknowledged mapping. Read-only archival personas must be filtered locally and rejected server-side.

**Why:** A dependent row without a remote parent mapping deterministically rolls back every retry, while accepting archival writes would violate the archive's immutable contract.

**How to apply:** Base dependency eligibility on rows actually emitted after count/byte trimming, not on rows merely queried as candidates.

Mutable local rows need a revision captured with the outgoing snapshot. Completion may clear the dirty marker only if the current revision still matches.

**Why:** A user can change mutable state while an older snapshot is in flight; unconditional completion would silently discard the newer mutation.

**How to apply:** Increment the local revision on every mutable change and condition acknowledgement updates on both row identity and captured revision.

Keep the exact UTF-8 JSON body comfortably below the server parser ceiling and defer matching local completion markers whenever a tail record is trimmed. Clear shared online caches only after reconciliation succeeds.

**Why:** Schema-valid record counts can still exceed transport limits, causing a permanent retry loop. Clearing caches before acknowledgement also hides local history while the server is still incomplete.

**How to apply:** Enforce one serialized-byte budget across all record categories, retry on reconnect/foreground while work remains, and preserve local state on every failure or partial acknowledgement.