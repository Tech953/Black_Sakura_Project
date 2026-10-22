---
name: Engram engine test mock
description: How the engram-engine unit test fakes the DB, and the trap when the engine starts reading a new table.
---

# Engram engine test mock (`artifacts/api-server/src/services/engram-engine.test.ts`)

The engine is unit-tested with no real DB. The shared test harness builds a fake
`db` whose `select()` resolves rows **by table identity**: it compares the table
passed to `.from(t)` against sentinel objects (e.g. `engramsTable`,
`engramPresenceTable`) and returns the matching in-memory store array.

**The trap:** when the engine starts reading a *new* table (directly or via a
helper like `lib/hub-store.ts`), you must update the test in two places or it
fails silently:
1. The shared `TABLE_NAMES`/schema map — add the new table export, or the helper
   imports `undefined` and `.from(undefined)` falls through to the default branch.
2. The store mapping and reset path — add the table's in-memory array and clear
   it in `reset()`.

If you skip step 2, the query returns `state.recent` (the default) instead of
erroring, so the test passes with the wrong data — a quiet false positive.

**Why:** helpers that wrap `db` (hub-store load/move functions) run against this
fake, so the engine test implicitly exercises them. Adding a DB read anywhere on
the tick path silently changes what the fake must model.

**How to apply:** any time `runTick`/its helpers gain a new `db.select().from(X)`,
extend the shared schema/store map and reset path. Keep the engine's compatibility
aliases only for assertions that predate the shared harness; route tests should
use the canonical store and table-aware update log.
