import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Run these against a REAL embedded Postgres (in-memory PGlite), not a mock, so
// the actual SQL/locking semantics of the media queue are exercised. The driver
// seam in `@workspace/db` reads `ENGRAM_DB_DRIVER` at import time, so it must be
// set *before* the module graph loads — `vi.hoisted` runs ahead of all imports.
// Leaving `PGLITE_DATA_DIR` unset makes PGlite run purely in-memory.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  db,
  ensureDatabaseReady,
  closeDb,
  mediaAssetsTable,
  mediaBlobsTable,
  mediaObservationsTable,
  engramWorldModelTable,
  engramsTable,
  conversations,
  messages,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { MediaModality, MediaJobStatus, MediaAsset } from "@workspace/db/schema";
import {
  claimNextPendingJob,
  recoverStuckJobs,
  appendMediaObservation,
  clearMediaObservations,
  requeueMediaAsset,
  loadMediaObservations,
  createMediaAsset,
  deleteMediaAsset,
  loadMediaAssetById,
  loadMediaBlob,
  upsertMediaContextMessage,
} from "./media-store";

// Bring the in-memory schema up before any test runs (migrate only — no seed).
const ready = ensureDatabaseReady({ seed: false });
const TEST_OWNER_ID = "test_media_store_owner";

beforeEach(async () => {
  await ready;
  await db.execute(sql`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__engram_system_template__'`);
  // Each test starts from an empty queue. Order matters: world-model + observation
  // rows reference assets/engrams, so clear children before parents. Media assets
  // reference messages (contextMessageId, set null) and conversations (cascade);
  // clear assets before messages/conversations so no asset points at a dropped row.
  await db.delete(mediaObservationsTable);
  await db.delete(engramWorldModelTable);
  await db.delete(mediaAssetsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
});

/** Insert a minimal valid engram row directly so world-model FKs are satisfiable. */
let engramSeq = 0;
async function insertEngram(): Promise<number> {
  engramSeq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      slug: `test-engram-${engramSeq}`,
      name: `Test Engram ${engramSeq}`,
      title: "Test",
      symbol: "T",
      origin: "test",
      voiceProfile: {
        speechStyle: "",
        formatting: "",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "" },
      environmentAnchor: {
        name: "",
        description: "",
        locations: [],
        items: [],
        ambient: "",
      },
      memorySeed: { relationship: "", facts: [], summary: "" },
      guardrails: { framing: "", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

afterAll(async () => {
  await closeDb();
});

/** Insert a media-asset row directly, bypassing the upload route. */
async function insertAsset(overrides: {
  status?: MediaJobStatus;
  modality?: MediaModality;
  createdAt?: Date;
  startedAt?: Date | null;
  engramId?: number | null;
  conversationId?: number | null;
}): Promise<number> {
  const [row] = await db
    .insert(mediaAssetsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      engramId: overrides.engramId ?? null,
      conversationId: overrides.conversationId ?? null,
      filename: "asset.txt",
      mimeType: "text/plain",
      modality: overrides.modality ?? "text",
      sizeBytes: 1,
      status: overrides.status ?? "pending",
      ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      ...(overrides.startedAt !== undefined ? { startedAt: overrides.startedAt } : {}),
    })
    .returning({ id: mediaAssetsTable.id });
  return row.id;
}

/** Insert a minimal conversation row so an inline upload can bind to a thread. */
async function insertConversation(): Promise<number> {
  const [row] = await db
    .insert(conversations)
    .values({ ownerId: TEST_OWNER_ID, title: "Inline chat thread" })
    .returning({ id: conversations.id });
  return row.id;
}

/** All messages in a conversation, oldest first. */
async function messagesOf(
  conversationId: number,
): Promise<Array<{ id: number; role: string; content: string }>> {
  return db
    .select({ id: messages.id, role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId));
}

/** Reload an asset as the full MediaAsset row the worker passes around. */
async function reloadAsset(id: number): Promise<MediaAsset> {
  const asset = await loadMediaAssetById(id);
  if (!asset) throw new Error(`asset ${id} not found`);
  return asset;
}

async function statusOf(id: number): Promise<MediaJobStatus | undefined> {
  const [row] = await db
    .select({ status: mediaAssetsTable.status })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  return row?.status as MediaJobStatus | undefined;
}

// --- claimNextPendingJob -------------------------------------------------------
describe("claimNextPendingJob — atomic claim against a real DB", () => {
  it("transitions exactly one pending row to 'processing' and stamps startedAt", async () => {
    const id = await insertAsset({ status: "pending" });

    const claimed = await claimNextPendingJob();

    expect(claimed).toBeDefined();
    expect(claimed!.id).toBe(id);
    expect(claimed!.status).toBe("processing");
    expect(claimed!.startedAt).toBeInstanceOf(Date);
    // The row really moved to processing in the DB, not just in the return value.
    expect(await statusOf(id)).toBe("processing");
  });

  it("returns undefined when nothing is pending", async () => {
    await insertAsset({ status: "completed" });
    await insertAsset({ status: "failed" });
    await insertAsset({ status: "processing", startedAt: new Date() });

    expect(await claimNextPendingJob()).toBeUndefined();
  });

  it("claims the OLDEST pending job first (FIFO by createdAt)", async () => {
    const older = await insertAsset({
      status: "pending",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    await insertAsset({
      status: "pending",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    const claimed = await claimNextPendingJob();
    expect(claimed!.id).toBe(older);
  });

  it("two concurrent claims of a single pending row yield it to exactly one caller", async () => {
    const id = await insertAsset({ status: "pending" });

    // FOR UPDATE SKIP LOCKED guarantees the second claimer never grabs the same
    // row: it is either skipped (locked) or sees no pending row once committed.
    const [a, b] = await Promise.all([
      claimNextPendingJob(),
      claimNextPendingJob(),
    ]);

    const winners = [a, b].filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.status).toBe("processing");
    // The single row was claimed once — never double-processed.
    expect(await statusOf(id)).toBe("processing");
  });

  it("two concurrent claims of two pending rows each get a distinct row", async () => {
    const first = await insertAsset({
      status: "pending",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const second = await insertAsset({
      status: "pending",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const [a, b] = await Promise.all([
      claimNextPendingJob(),
      claimNextPendingJob(),
    ]);

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // No two workers ever land on the same upload.
    expect(new Set([a!.id, b!.id])).toEqual(new Set([first, second]));
  });
});

// --- recoverStuckJobs ----------------------------------------------------------
describe("recoverStuckJobs — stuck-job recovery against a real DB", () => {
  const ONE_HOUR = 60 * 60 * 1000;

  it("fails only 'processing' rows started before the cutoff", async () => {
    const stuck = await insertAsset({
      status: "processing",
      startedAt: new Date(Date.now() - 2 * ONE_HOUR),
    });

    const recovered = await recoverStuckJobs(ONE_HOUR);

    expect(recovered).toBe(1);
    expect(await statusOf(stuck)).toBe("failed");
    const [row] = await db
      .select({ error: mediaAssetsTable.error })
      .from(mediaAssetsTable)
      .where(eq(mediaAssetsTable.id, stuck));
    expect(row.error).toMatch(/timed out/i);
  });

  it("leaves a fresh 'processing' row (started after the cutoff) alone", async () => {
    const fresh = await insertAsset({
      status: "processing",
      startedAt: new Date(Date.now() - 1000),
    });

    const recovered = await recoverStuckJobs(ONE_HOUR);

    expect(recovered).toBe(0);
    expect(await statusOf(fresh)).toBe("processing");
  });

  it("never touches pending/completed/failed rows, however old", async () => {
    const oldStart = new Date(Date.now() - 5 * ONE_HOUR);
    const pending = await insertAsset({ status: "pending" });
    const completed = await insertAsset({
      status: "completed",
      startedAt: oldStart,
    });
    const failed = await insertAsset({ status: "failed", startedAt: oldStart });

    const recovered = await recoverStuckJobs(ONE_HOUR);

    expect(recovered).toBe(0);
    expect(await statusOf(pending)).toBe("pending");
    expect(await statusOf(completed)).toBe("completed");
    expect(await statusOf(failed)).toBe("failed");
  });

  it("recovers only the stuck rows when stuck and fresh jobs coexist", async () => {
    const stuck = await insertAsset({
      status: "processing",
      startedAt: new Date(Date.now() - 3 * ONE_HOUR),
    });
    const fresh = await insertAsset({
      status: "processing",
      startedAt: new Date(Date.now() - 1000),
    });

    const recovered = await recoverStuckJobs(ONE_HOUR);

    expect(recovered).toBe(1);
    expect(await statusOf(stuck)).toBe("failed");
    expect(await statusOf(fresh)).toBe("processing");
  });

  it("a recovered (now 'failed') job is no longer claimable", async () => {
    await insertAsset({
      status: "processing",
      startedAt: new Date(Date.now() - 2 * ONE_HOUR),
    });

    await recoverStuckJobs(ONE_HOUR);

    // Recovery fails the wedged job; it does NOT re-queue it, so the worker
    // won't immediately re-claim a job that just timed out.
    expect(await claimNextPendingJob()).toBeUndefined();
  });
});

// --- Helpers for observation/world-model assertions ---------------------------

/** Every world-model row currently in the DB, with the fields we care about. */
async function allWorldModelRows(): Promise<
  Array<{
    id: number;
    engramId: number;
    provenance: string;
    source: string | null;
    content: string;
  }>
> {
  return db
    .select({
      id: engramWorldModelTable.id,
      engramId: engramWorldModelTable.engramId,
      provenance: engramWorldModelTable.provenance,
      source: engramWorldModelTable.source,
      content: engramWorldModelTable.content,
    })
    .from(engramWorldModelTable);
}

/** Count of mapping rows tying an asset to its world-model entries. */
async function observationLinkCount(assetId: number): Promise<number> {
  const rows = await db
    .select({ id: mediaObservationsTable.id })
    .from(mediaObservationsTable)
    .where(eq(mediaObservationsTable.assetId, assetId));
  return rows.length;
}

// --- appendMediaObservation: lands as a real OBSERVED row ----------------------
describe("appendMediaObservation — real world-model + mapping write", () => {
  it("writes an OBSERVED entry tagged media:<id> and a linking mapping row", async () => {
    const engramId = await insertEngram();
    const assetId = await insertAsset({ status: "processing", engramId });

    const entry = await appendMediaObservation({
      assetId,
      engramId,
      content: "A lighthouse blinks twice.",
      confidence: 0.85,
    });

    // The world-model row really exists, read back from the DB (not the return
    // value), with provenance EXACTLY "observed" and source EXACTLY media:<id>.
    const rows = await allWorldModelRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: entry.id,
      engramId,
      provenance: "observed",
      source: `media:${assetId}`,
      content: "A lighthouse blinks twice.",
    });
    // The locked provenance/source are also what the function returned.
    expect(entry.provenance).toBe("observed");
    expect(entry.source).toBe(`media:${assetId}`);
    // ...and exactly one mapping row links the asset to that entry.
    expect(await observationLinkCount(assetId)).toBe(1);
    const linked = await loadMediaObservations(assetId);
    expect(linked.map((e) => e.id)).toEqual([entry.id]);
  });
});

// --- deleteMediaAsset: removes the file, PRESERVES the observation ------------
describe("deleteMediaAsset — drops asset/blob/mapping, keeps world-model entry", () => {
  it("removes the asset, its bytes, and its mapping rows but PRESERVES the OBSERVED entry", async () => {
    const engramId = await insertEngram();
    // Go through the real upload path so a genuine blob row exists alongside the asset.
    const asset = await createMediaAsset({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "scene.txt",
      mimeType: "text/plain",
      modality: "text",
      data: Buffer.from("a lighthouse on a cliff"),
    });

    const entry = await appendMediaObservation({
      assetId: asset.id,
      engramId,
      content: "A lighthouse stands on a cliff.",
      confidence: 0.9,
    });

    // Pre-conditions: asset, blob, mapping row, and world-model entry all present.
    expect(await loadMediaAssetById(asset.id)).toBeDefined();
    expect(await loadMediaBlob(asset.id)).toBeDefined();
    expect(await observationLinkCount(asset.id)).toBe(1);
    expect(await allWorldModelRows()).toHaveLength(1);

    const deleted = await deleteMediaAsset(asset.id);
    expect(deleted).toBe(true);

    // The source file and everything that points back to it is gone...
    expect(await loadMediaAssetById(asset.id)).toBeUndefined();
    expect(await loadMediaBlob(asset.id)).toBeUndefined();
    expect(await observationLinkCount(asset.id)).toBe(0);
    expect(
      await db
        .select({ assetId: mediaBlobsTable.assetId })
        .from(mediaBlobsTable)
        .where(eq(mediaBlobsTable.assetId, asset.id)),
    ).toHaveLength(0);

    // ...but the genuine OBSERVED entry outlives the file, provenance/source intact.
    const rows = await allWorldModelRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: entry.id,
      engramId,
      provenance: "observed",
      source: `media:${asset.id}`,
      content: "A lighthouse stands on a cliff.",
    });
  });

  it("returns false when the asset does not exist and touches no world-model rows", async () => {
    const engramId = await insertEngram();
    const assetId = await insertAsset({ status: "completed", engramId });
    await appendMediaObservation({
      assetId,
      engramId,
      content: "kept observation",
      confidence: 0.5,
    });

    expect(await deleteMediaAsset(999)).toBe(false);

    // The unrelated asset and its observation are untouched.
    expect(await loadMediaAssetById(assetId)).toBeDefined();
    expect(await allWorldModelRows()).toHaveLength(1);
  });

  it("deletes ONLY the targeted asset — a sibling asset's observation and a non-media belief on the SAME engram survive", async () => {
    // One engram owns two distinct uploads, each producing its own OBSERVED entry,
    // plus a manually-remembered belief that isn't tied to any media file. This is
    // the blast-radius guard: a delete must scope to the asset id, never the engram,
    // so an accidental over-broad delete (e.g. matching by engramId) would fail here.
    const engramId = await insertEngram();

    const assetA = await createMediaAsset({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "a.txt",
      mimeType: "text/plain",
      modality: "text",
      data: Buffer.from("scene A"),
    });
    const assetB = await createMediaAsset({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "b.txt",
      mimeType: "text/plain",
      modality: "text",
      data: Buffer.from("scene B"),
    });

    const entryA = await appendMediaObservation({
      assetId: assetA.id,
      engramId,
      content: "Observation from asset A.",
      confidence: 0.8,
    });
    const entryB = await appendMediaObservation({
      assetId: assetB.id,
      engramId,
      content: "Observation from asset B.",
      confidence: 0.7,
    });

    // A non-media belief on the same engram (manually remembered, source != media:*).
    const [belief] = await db
      .insert(engramWorldModelTable)
      .values({
        engramId,
        provenance: "remembered",
        content: "A belief the engram already held.",
        confidence: 0.9,
        scope: "private",
        source: "manual",
      })
      .returning({ id: engramWorldModelTable.id });

    // Pre-conditions: two assets, two blobs, two mapping rows, three world-model rows.
    expect(await loadMediaAssetById(assetA.id)).toBeDefined();
    expect(await loadMediaAssetById(assetB.id)).toBeDefined();
    expect(await loadMediaBlob(assetA.id)).toBeDefined();
    expect(await loadMediaBlob(assetB.id)).toBeDefined();
    expect(await observationLinkCount(assetA.id)).toBe(1);
    expect(await observationLinkCount(assetB.id)).toBe(1);
    expect(await allWorldModelRows()).toHaveLength(3);

    const deleted = await deleteMediaAsset(assetA.id);
    expect(deleted).toBe(true);

    // Asset A and everything pointing back at it is gone...
    expect(await loadMediaAssetById(assetA.id)).toBeUndefined();
    expect(await loadMediaBlob(assetA.id)).toBeUndefined();
    expect(await observationLinkCount(assetA.id)).toBe(0);

    // ...but asset B is completely untouched: row, blob, and mapping all intact.
    expect(await loadMediaAssetById(assetB.id)).toBeDefined();
    expect(await loadMediaBlob(assetB.id)).toBeDefined();
    expect(await observationLinkCount(assetB.id)).toBe(1);

    // The world model still holds exactly the entries that must survive: asset A's
    // OBSERVED entry (outlives its source file), asset B's OBSERVED entry, and the
    // non-media belief. Only the count dropped from collateral deletion would change
    // it — it doesn't. Count proves no over-broad delete by engramId occurred.
    const rows = await allWorldModelRows();
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(entryA.id)).toMatchObject({
      engramId,
      provenance: "observed",
      source: `media:${assetA.id}`,
      content: "Observation from asset A.",
    });
    expect(byId.get(entryB.id)).toMatchObject({
      engramId,
      provenance: "observed",
      source: `media:${assetB.id}`,
      content: "Observation from asset B.",
    });
    expect(byId.get(belief.id)).toMatchObject({
      engramId,
      provenance: "remembered",
      source: "manual",
      content: "A belief the engram already held.",
    });
  });
});

// --- clearMediaObservations: removes only this asset's footprint ---------------
describe("clearMediaObservations — scoped, idempotent cleanup against a real DB", () => {
  it("removes exactly this asset's world-model + mapping rows, leaving others intact", async () => {
    const engA = await insertEngram();
    const engB = await insertEngram();
    const assetA = await insertAsset({ status: "processing", engramId: engA });
    const assetB = await insertAsset({ status: "processing", engramId: engB });

    // Two observations for asset A (engram A), one for asset B (engram B).
    await appendMediaObservation({ assetId: assetA, engramId: engA, content: "a1", confidence: 0.5 });
    await appendMediaObservation({ assetId: assetA, engramId: engA, content: "a2", confidence: 0.6 });
    await appendMediaObservation({ assetId: assetB, engramId: engB, content: "b1", confidence: 0.7 });

    await clearMediaObservations(assetA);

    // Asset A's entries + mapping rows are gone...
    expect(await observationLinkCount(assetA)).toBe(0);
    expect(await loadMediaObservations(assetA)).toHaveLength(0);
    // ...but asset B's (other engram, other asset) survive untouched.
    expect(await observationLinkCount(assetB)).toBe(1);
    const remaining = await allWorldModelRows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      engramId: engB,
      source: `media:${assetB}`,
      content: "b1",
    });
  });

  it("leaves world-model rows with a non-media source tag alone", async () => {
    const engramId = await insertEngram();
    const assetId = await insertAsset({ status: "processing", engramId });

    // A genuine media observation plus an unrelated, manually-sourced belief.
    await appendMediaObservation({ assetId, engramId, content: "perceived", confidence: 0.8 });
    await db.insert(engramWorldModelTable).values({
      engramId,
      provenance: "remembered",
      content: "unrelated belief",
      confidence: 0.9,
      scope: "private",
      source: "manual",
    });

    await clearMediaObservations(assetId);

    // Only the media:<id>-tagged row was dropped; the manual belief remains.
    const rows = await allWorldModelRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", content: "unrelated belief" });
  });

  it("is a no-op when the asset never produced observations", async () => {
    const engramId = await insertEngram();
    const otherAsset = await insertAsset({ status: "processing", engramId });
    await appendMediaObservation({ assetId: otherAsset, engramId, content: "keep", confidence: 0.5 });

    // Clearing an asset id that has no observations must not throw or touch others.
    await clearMediaObservations(999);

    expect(await allWorldModelRows()).toHaveLength(1);
    expect(await observationLinkCount(otherAsset)).toBe(1);
  });

  it("a clear-then-reappend retry yields the same observation count, never doubled", async () => {
    const engramId = await insertEngram();
    const assetId = await insertAsset({ status: "processing", engramId });

    // First perception pass: two observations.
    const firstRun = async () => {
      await clearMediaObservations(assetId);
      await appendMediaObservation({ assetId, engramId, content: "obs-1", confidence: 0.5 });
      await appendMediaObservation({ assetId, engramId, content: "obs-2", confidence: 0.6 });
    };
    await firstRun();
    expect(await observationLinkCount(assetId)).toBe(2);
    expect(await allWorldModelRows()).toHaveLength(2);

    // Retry runs the exact same clear-then-append sequence the worker uses.
    await firstRun();

    // The retry REPLACED the prior run — the count is identical, not doubled.
    expect(await observationLinkCount(assetId)).toBe(2);
    expect(await allWorldModelRows()).toHaveLength(2);
  });
});

// --- requeueMediaAsset: atomic, single-winner requeue -------------------------
describe("requeueMediaAsset — atomic failed→pending against a real DB", () => {
  it("requeues a failed asset to pending and resets its prior results", async () => {
    const id = await insertAsset({ status: "failed" });
    await db
      .update(mediaAssetsTable)
      .set({
        error: "boom",
        summary: "old summary",
        commentary: "old commentary",
        transcript: "old transcript",
        observationCount: 3,
        startedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(mediaAssetsTable.id, id));

    const row = await requeueMediaAsset(id);

    expect(row).toBeDefined();
    expect(row!.status).toBe("pending");
    expect(row!.error).toBeNull();
    expect(row!.summary).toBeNull();
    expect(row!.commentary).toBeNull();
    expect(row!.transcript).toBeNull();
    expect(row!.observationCount).toBe(0);
    expect(row!.startedAt).toBeNull();
    expect(row!.completedAt).toBeNull();
    expect(await statusOf(id)).toBe("pending");
  });

  it("refuses to requeue an asset that is not currently failed", async () => {
    const pending = await insertAsset({ status: "pending" });
    const processing = await insertAsset({ status: "processing", startedAt: new Date() });
    const completed = await insertAsset({ status: "completed" });

    expect(await requeueMediaAsset(pending)).toBeUndefined();
    expect(await requeueMediaAsset(processing)).toBeUndefined();
    expect(await requeueMediaAsset(completed)).toBeUndefined();
    // Statuses are unchanged — the status='failed' guard held.
    expect(await statusOf(pending)).toBe("pending");
    expect(await statusOf(processing)).toBe("processing");
    expect(await statusOf(completed)).toBe("completed");
  });

  it("two concurrent requeues of the same failed asset produce exactly one winner", async () => {
    const id = await insertAsset({ status: "failed" });

    // The status='failed' guard lives inside the UPDATE, so only one of the two
    // racing requeues can match the row — the loser updates zero rows.
    const [a, b] = await Promise.all([
      requeueMediaAsset(id),
      requeueMediaAsset(id),
    ]);

    const winners = [a, b].filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.status).toBe("pending");
    expect(await statusOf(id)).toBe("pending");
  });
});

// --- upsertMediaContextMessage: one inline-upload context message, retry-safe ---
describe("upsertMediaContextMessage — idempotent inline-chat context message", () => {
  it("first completion inserts exactly one 'context' message and stamps contextMessageId", async () => {
    const conversationId = await insertConversation();
    const assetId = await insertAsset({ status: "completed", conversationId });
    const asset = await reloadAsset(assetId);
    // Pre-condition: a fresh inline upload has no context message yet.
    expect(asset.contextMessageId).toBeNull();

    await upsertMediaContextMessage(asset, "Perceived: a lighthouse on a cliff.");

    // Exactly one context message landed in the thread, read back from the DB.
    const msgs = await messagesOf(conversationId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("context");
    expect(msgs[0].content).toBe("Perceived: a lighthouse on a cliff.");

    // ...and the asset now points at that exact message (the idempotency anchor).
    const stamped = await reloadAsset(assetId);
    expect(stamped.contextMessageId).toBe(msgs[0].id);
  });

  it("a second call (retry/re-perception) updates the SAME message — never a duplicate", async () => {
    const conversationId = await insertConversation();
    const assetId = await insertAsset({ status: "completed", conversationId });

    // First completion inserts the message and stamps the asset.
    await upsertMediaContextMessage(await reloadAsset(assetId), "First perception.");
    const afterFirst = await messagesOf(conversationId);
    expect(afterFirst).toHaveLength(1);
    const messageId = afterFirst[0].id;
    const stampedId = (await reloadAsset(assetId)).contextMessageId;
    expect(stampedId).toBe(messageId);

    // Retry: the worker re-runs with the now-stamped asset (contextMessageId set).
    await upsertMediaContextMessage(await reloadAsset(assetId), "Revised perception after retry.");

    // Still exactly one message — the same row, content updated in place.
    const afterRetry = await messagesOf(conversationId);
    expect(afterRetry).toHaveLength(1);
    expect(afterRetry[0].id).toBe(messageId);
    expect(afterRetry[0].content).toBe("Revised perception after retry.");
    // The anchor never moved.
    expect((await reloadAsset(assetId)).contextMessageId).toBe(messageId);
  });

  it("repeated retries never accumulate messages, even across many re-perceptions", async () => {
    const conversationId = await insertConversation();
    const assetId = await insertAsset({ status: "completed", conversationId });

    for (let i = 0; i < 5; i += 1) {
      await upsertMediaContextMessage(await reloadAsset(assetId), `Perception pass ${i}.`);
    }

    // Five completions/retries → still one message, holding the last content.
    const msgs = await messagesOf(conversationId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("Perception pass 4.");
  });

  it("is a no-op when the asset is not bound to a conversation (no conversationId)", async () => {
    // A Media-page upload (or engram-linked, non-chat upload) has no thread.
    const assetId = await insertAsset({ status: "completed", conversationId: null });
    const asset = await reloadAsset(assetId);
    expect(asset.conversationId).toBeNull();

    await upsertMediaContextMessage(asset, "Should never be posted anywhere.");

    // No message anywhere, and the asset stays unstamped.
    expect(await db.select().from(messages)).toHaveLength(0);
    expect((await reloadAsset(assetId)).contextMessageId).toBeNull();
  });

  it("keeps each inline upload's context message scoped to its own thread", async () => {
    const convA = await insertConversation();
    const convB = await insertConversation();
    const assetA = await insertAsset({ status: "completed", conversationId: convA });
    const assetB = await insertAsset({ status: "completed", conversationId: convB });

    await upsertMediaContextMessage(await reloadAsset(assetA), "Context for thread A.");
    await upsertMediaContextMessage(await reloadAsset(assetB), "Context for thread B.");

    // Each thread got exactly its own one message; no cross-posting.
    const msgsA = await messagesOf(convA);
    const msgsB = await messagesOf(convB);
    expect(msgsA).toHaveLength(1);
    expect(msgsB).toHaveLength(1);
    expect(msgsA[0].content).toBe("Context for thread A.");
    expect(msgsB[0].content).toBe("Context for thread B.");
    // Retrying A leaves B completely untouched.
    await upsertMediaContextMessage(await reloadAsset(assetA), "A revised.");
    expect(await messagesOf(convA)).toHaveLength(1);
    expect((await messagesOf(convB))[0].content).toBe("Context for thread B.");
  });
});
