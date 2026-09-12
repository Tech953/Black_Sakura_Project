---
name: api-routes test db/schema mock
description: Why engine-touching route tests (/tick, /transmit) break, and how the hand-rolled db/schema vitest mock must be kept in sync.
---

`artifacts/api-server/src/routes/api-routes.test.ts` builds a fake `@workspace/db` + `@workspace/db/schema` from a `TABLE_NAMES` whitelist of `{ __table }` proxy objects, plus a fake query/insert builder. It does NOT auto-mirror the real schema barrel.

The rule: anything the engine path imports from the schema barrel must be present in this mock, or the route under test throws during setup and the failure is swallowed into a generic 500/503 — so the assertion failure looks unrelated to the missing mock.

**Why:** the engine tick (controls-store → loadControls) imports the non-table constant `HUB_CONTROLS_ID` from the schema; when the mock lacked it, loadControls threw and `/tick` returned 500, `/transmit` 503 — with no obvious link to the real cause, costing real debugging time. Owner-scoped routes fail just as opaquely when fixtures omit the authenticated owner.

**How to apply:** when you add a table, a non-table export, or a new drizzle builder method used on the engine path, update this mock: new tables → add to `TABLE_NAMES`; non-table constants (e.g. `HUB_CONTROLS_ID`) → set directly on the `schema` object; new builder methods (including `selectDistinct` and `innerJoin`) → add to the fake query builder. Set fixture `ownerId` values and install the test user middleware whenever a route enforces ownership. Also keep engram columns in sync with required fields (mode, humanContactEnabled, simulationEnabled, …).

World-model route coverage additionally depends on the fake query builder preserving table-qualified rows across `innerJoin` and honoring projected selects such as `{ entry: engramWorldModelTable }`; otherwise ownership checks and route serializers receive the wrong row shape.

**Why:** the world-model routes join entries to their owning engram and select the entry under a named property. A mock that only filters one flat table can make valid entries look missing or bypass the route's expected response shape.

**How to apply:** for new joined route tests, keep join predicates table-aware and return projected objects matching the router's Drizzle query shape. Add schema table exports used by asynchronous side effects too, such as push-token delivery.
