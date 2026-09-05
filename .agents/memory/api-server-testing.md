---
name: API server testing
description: Conventions and constraints for unit-testing the api-server artifact.
---

# API server testing

The `@workspace/api-server` artifact is unit-tested with **vitest** (`pnpm --filter @workspace/api-server run test`, or root `pnpm test`). Tests live beside source as `src/**/*.test.ts`.

**Importing engine/route code requires mocking the db.** `@workspace/db`'s entry eagerly opens a pg pool and throws unless `DATABASE_URL` is set, so any test that imports modules touching it must mock `@workspace/db` (and `@workspace/db/schema`) before the import. `prompts.ts` is the exception — it imports only `type`s from the db, which are erased at transpile, so prompt tests need no mocks.
**Why it matters:** without the mock, the test process either crashes on import or tries to reach a real database.

**PGlite-backed suites must run one test file at a time.** Keep Vitest file parallelism disabled for the API artifact even if individual suites pass in isolation.
**Why:** parallel embedded Postgres startup intermittently starves initialization hooks and app workflows, producing unrelated timeouts and false queue failures during release-gate runs.
**How to apply:** parallelism inside a suite is fine only when that suite explicitly owns and isolates its database; do not re-enable file-level parallelism globally.

**HARD_SAFETY belongs to PYRI *and* engram prompts.** The non-negotiable safety block (no sexual content, no real-world hacking/cyber-abuse, construct/sandbox containment) is a single shared constant injected into both `buildSystemPrompt` (PYRI) and `buildEngramSystemPrompt`. Keep it shared, not copy-pasted, and keep clause wording stable — regression tests assert exact phrases. It must survive every chat mode, persona, and a hostile `customEngram` override.
**Why:** the original PYRI prompt omitted this block entirely; the test suite exists specifically to stop that gap from reopening as new modes/personas are added.

**A forced engine tick bypasses cadence only, not the initiation threshold** — useful to know when writing/maintaining engine tests.
