---
name: Desktop built-in model retry
description: Transactional retry semantics for recovering the bundled desktop model after a persisted startup failure.
---

The bundled-model retry must validate the candidate strictly, while rollback starts the previous settings non-strictly so a persisted `bundled` choice can recover through its local-server fallback when the same runtime failure remains.

**Why:** A failed built-in startup can leave settings persisted as `bundled` even though the running desktop server has degraded to the external local provider. Strictly restarting that previous setting during retry rollback would fail a second time and remove the safe fallback.

**How to apply:** Reuse the existing settings activation transaction for retries, but keep strict local-model health checks scoped to the candidate activation only. Preserve the structured failure in settings after a failed retry and clear it only after candidate activation and persistence succeed.