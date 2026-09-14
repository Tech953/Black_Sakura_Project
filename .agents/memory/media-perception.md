---
name: Media perception provenance & idempotency
description: Invariants for the ENGRAM media-perception pipeline (operator uploads → OBSERVED world-model entries) — provenance hardcoding, retry idempotency, deletion policy, worker test mocking.
---

# Media perception pipeline invariants

## Provenance is structural, not advisory
Anything an engram "perceives" from uploaded media may enter its world model ONLY as `provenance: "observed"` with `source: "media:<assetId>"`. Both are hardcoded at the lowest write layer (the store's append helper); model output has no channel to set provenance or source.
**Why:** this is the mirror of the simulation pipeline's hardcoded `"simulated"` provenance. The two opposite guarantees together mean reality-vs-simulation can never be forged by model text — perception can't masquerade as simulation and vice-versa.
**How to apply:** never add a parameter that lets a caller (or model output) choose provenance/source on a world-model write; keep the hardcode in the append helper, not the worker.

## Retry must REPLACE, not duplicate
Re-processing the same bytes (a retry) must clear the asset's prior world-model entries + mapping rows BEFORE appending the fresh set — at the start of processing, after the blob check, before extraction. The retry status guard lives inside the UPDATE (`WHERE id AND status='failed'`), not a separate read, so a concurrent retry loser updates zero rows and the route returns 409.
**Why:** without the up-front clear, a retry stacks duplicate observations on top of a prior partial run; without the atomic guard, two retries both requeue.
**How to apply:** any reprocessing path for provenance-tagged derived rows needs an idempotent clear keyed by the same `source` tag, plus a status-guarded atomic requeue.

## Completion is one database commit
After extraction, the complete observation set, asset-to-observation mappings, and completed asset metadata must be written through the same transaction executor. External model calls stay outside that transaction; a failed commit leaves the job non-completed for recovery/retry.
**Why:** committing observations one at a time can expose a partial completed result if the worker dies before the final asset update.
**How to apply:** store helpers that participate in the completion boundary must accept the caller's transaction executor instead of reaching for the global database handle.

## Failed processing is all-or-nothing
The worker clears prior derived rows atomically, then writes the fresh observations and completed metadata in one transaction. Any failure before that commit resets result metadata to zero and leaves the asset failed; the API derives `resultState` as `none`, `partial`, or `complete` so legacy rows remain explicit.
**Why:** operators must never mistake a failed attempt with stale or partially committed rows for a trustworthy completed perception; retries must have one clear replacement boundary.
**How to apply:** keep post-commit notifications best-effort, preserve `observationCount: 0` and null result fields on failure, and use the same result-state contract in web and mobile recovery UI.

## Deletion preserves observations
Deleting a media asset cascades the blob + observation MAPPING rows but PRESERVES the world-model entries — they are genuine observations that outlive the source file (entries are not FK-owned by the asset; only the mapping table is).

## Bytes live apart from metadata
Raw bytes are in a separate 1:1 `media_blobs` table so list/status/poll queries never load megabytes. Only the `/raw` streaming route loads bytes.

## Upload type checks need complete signatures
Upload validation uses byte signatures for binary formats and UTF-8/parser checks for text; tests that represent valid binaries must include the full signature, not just a truncated prefix.
**Why:** accepting only a partial magic header creates a false-positive test and would let malformed media reach the worker.
**How to apply:** when adding an allowlisted format, add a minimally complete signature fixture and a mislabeled-byte rejection case at both detector and upload-route levels.

## Validate stored media at read boundaries
Upload-time MIME, byte-signature, and filename-extension checks are not enough for raw preview or retry: those routes must revalidate the stored asset and blob before exposing or re-queueing them.
**Why:** older rows, direct database writes, or future migrations can bypass the current upload handler; preview and perception should fail closed rather than trust metadata alone.
**How to apply:** keep extension aliases in the extraction validator, return a specific 415 response, and require the client to upload the original file again.

## Vitest mocking gotcha (worker/route tests)
All `vi.fn()` mocks referenced inside `vi.mock(...)` factories must be created inside `vi.hoisted(() => ...)` and referenced via the returned handle, or you hit a TDZ error (the factory is hoisted above the consts). When a test destructures `mock.calls[0]` (e.g. `const [id, patch] = updateMediaAsset.mock.calls[0]`), give the mock an explicit arg signature (`vi.fn(async (_id: number, _patch: Record<string, unknown>) => ...)`) — otherwise tsc infers an empty-tuple call type and the destructure fails the api-server typecheck even though the test runs green. `await res.json()` from `fetch` is typed `unknown`; cast it in route tests.
