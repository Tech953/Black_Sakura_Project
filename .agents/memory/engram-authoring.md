---
name: Engram authoring (seed data)
description: Non-obvious couplings when adding a new engram to the seed so it behaves as intended.
---

# Adding a new engram

Add the entry to `scripts/src/seed-engrams.ts` (matches `NewEngram` shape) and run `pnpm --filter @workspace/scripts run seed:engrams`. The seed is idempotent via `onConflictDoNothing` on `slug`, so existing engrams are untouched and only the new one inserts. The frontend selectors list all engrams, so no UI code change is needed.

**Outreach vs idle is controlled by drive naming, not a flag.** The autonomous engine's `pickKind` classifies a transmission as `outreach` (a message directed *at the operator*) only when the firing drive's `id`/`label` matches an internal keyword regex (connection|devotion|loyal|protect|chaos|fun|reach|company); otherwise it produces an `idle` self-monologue. So if a new engram should ever reach out unprompted, give its highest-weight drive a label containing one of those words (e.g. T-Bug's top drive is "Overwatch / **Protection**"). An engram whose drives match none will only ever idle-monologue, never contact the operator.

**Persona safety is layered.** Per-engram `guardrails.framing`/`boundaries` are prompt copy injected into the system prompt; the immutable `HARD_SAFETY` block in `prompts.ts` is the real backstop and is persona-agnostic (covers containment, platonic-only, no real-world harm, and no real-world cyber/intrusion instructions). Put persona-specific flavour limits in seed guardrails, but rely on `HARD_SAFETY` for hard refusals — and extend `HARD_SAFETY` (not just seed copy) when a new persona theme opens a new abuse surface.

**Why:** mobile imports the pure engram seed data directly, while server backfills need Drizzle/database runtime imports. Mixing those layers can inflate or break the mobile bundle.

**How to apply:** keep reusable persona constants in a database-free module; put idempotent world-model/memory backfills in a server-only seed module, and wire that backfill into both the PGlite bootstrap and the standalone Postgres seed command.
