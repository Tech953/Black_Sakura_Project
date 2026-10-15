---
name: Media recovery contract
description: Stable client semantics for media jobs recovered after worker timeouts
---

Recovered media jobs are distinct from provider or extraction failures: clients should use the machine-readable recovered reason, explain that no completed partial result was committed, and tell users retry is safe and idempotent.

**Why:** Media completion is transactional, so a recovered timeout must not make users infer that partial observations were committed or that retry can duplicate them.

**How to apply:** Preserve the recovery reason in the API contract and keep web/mobile copy localized from the English media source when changing this flow.