import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Drive the WHOLE media tick (recover stuck jobs -> claim -> process -> complete/fail)
// against a REAL embedded Postgres (in-memory PGlite). The unit suites cover the store
// SQL (`media-store.db.test.ts`) and the tick wiring with every collaborator mocked
// (`media-worker.test.ts`); this suite is the missing middle — the steps wired together
// against the real DB. Only the LLM/extraction seam is stubbed (no model calls); the
// queue, the claim, the world-model writes, and the observation mapping are all real.
//
// The driver seam in `@workspace/db` reads `ENGRAM_DB_DRIVER` at import time, so it must
// be set BEFORE the module graph loads — `vi.hoisted` runs ahead of all imports. Leaving
// `PGLITE_DATA_DIR` unset makes PGlite run purely in-memory.
const h = vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
  return {
    extractFromMedia: vi.fn(),
    generateMediaCommentary: vi.fn(async () => "in-voice reaction"),
  };
});

// Stub ONLY the LLM/extraction seam. Everything else (db, media-store, world-model-store,
// world-model summarizer, the event bus) is the real implementation.
vi.mock("../lib/media-extraction", () => ({ extractFromMedia: h.extractFromMedia }));
vi.mock("../lib/engram-generation", () => ({
  generateMediaCommentary: h.generateMediaCommentary,
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  db,
  ensureDatabaseReady,
  closeDb,
  mediaAssetsTable,
  mediaObservationsTable,
  engramWorldModelTable,
  engramsTable,
  conversations,
  messages,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { MediaAsset } from "@workspace/db/schema";
import { createMediaAsset } from "../lib/media-store";
import { runMediaTick } from "./media-worker";

// Bring the in-memory schema up before any test runs (migrate only — no seed).
const ready = ensureDatabaseReady({ seed: false });
const TEST_OWNER_ID = "test_media_worker_owner";

beforeEach(async () => {
  await ready;
  await db.execute(sql`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__engram_system_template__'`);
  // Each test starts from an empty queue. Clear children before parents (same FK
  // ordering as media-store.db.test.ts).
  await db.delete(mediaObservationsTable);
  await db.delete(engramWorldModelTable);
  await db.delete(mediaAssetsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);

  vi.clearAllMocks();
  // Default extraction result: two observations, a summary, no transcript.
  h.extractFromMedia.mockResolvedValue({
    observations: ["A lighthouse blinks twice.", "A gull settles on the rail."],
    summary: "Two short images of a harbor.",
    transcript: null,
  });
  h.generateMediaCommentary.mockResolvedValue("in-voice reaction");
});

afterAll(async () => {
  await closeDb();
});

// --- Fixtures ------------------------------------------------------------------

let engramSeq = 0;
/** Insert a minimal valid engram row directly so world-model FKs are satisfiable. */
async function insertEngram(): Promise<number> {
  engramSeq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      slug: `wk-engram-${engramSeq}`,
      name: `Worker Engram ${engramSeq}`,
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

/** Seed a real pending asset + blob through the actual upload path. */
async function seedPendingAsset(engramId: number | null): Promise<MediaAsset> {
  return createMediaAsset({
    ownerId: TEST_OWNER_ID,
    engramId,
    filename: "harbor.txt",
    mimeType: "text/plain",
    modality: "text",
    data: Buffer.from("a lighthouse and a gull at the harbor"),
  });
}

/** Insert a 'processing' asset directly with a chosen startedAt (for stuck-job tests). */
async function insertProcessingAsset(
  engramId: number | null,
  startedAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(mediaAssetsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "harbor.txt",
      mimeType: "text/plain",
      modality: "text",
      sizeBytes: 1,
      status: "processing",
      startedAt,
    })
    .returning({ id: mediaAssetsTable.id });
  return row.id;
}

// --- Assertion helpers ---------------------------------------------------------

async function statusOf(id: number): Promise<string | undefined> {
  const [row] = await db
    .select({ status: mediaAssetsTable.status })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  return row?.status;
}

async function reload(id: number): Promise<MediaAsset> {
  const [row] = await db
    .select()
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  if (!row) throw new Error(`asset ${id} not found`);
  return row;
}

/** Every world-model row, with the fields we assert on. */
async function allWorldModelRows(): Promise<
  Array<{ id: number; engramId: number; provenance: string; source: string | null; content: string }>
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

// --- Full tick end-to-end ------------------------------------------------------
describe("runMediaTick — full lifecycle against a real DB", () => {
  it("processes a pending asset to completed with exactly one set of OBSERVED entries", async () => {
    const engramId = await insertEngram();
    const asset = await seedPendingAsset(engramId);

    const result = await runMediaTick();

    expect(result.processed).toBe(1);
    expect(h.extractFromMedia).toHaveBeenCalledTimes(1);

    // The asset really moved pending -> completed in the DB, with the extracted
    // summary/commentary and an accurate observation count.
    const completed = await reload(asset.id);
    expect(completed.status).toBe("completed");
    expect(completed.summary).toBe("Two short images of a harbor.");
    expect(completed.commentary).toBe("in-voice reaction");
    expect(completed.observationCount).toBe(2);
    expect(completed.completedAt).toBeInstanceOf(Date);
    expect(completed.error).toBeNull();

    // Exactly one set of OBSERVED world-model entries — one per extracted line, all
    // provenance-pinned and tagged media:<id>. No duplicates.
    const rows = await allWorldModelRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.engramId).toBe(engramId);
      expect(row.provenance).toBe("observed");
      expect(row.source).toBe(`media:${asset.id}`);
    }
    expect(rows.map((r) => r.content).sort()).toEqual(
      ["A gull settles on the rail.", "A lighthouse blinks twice."],
    );
    // ...and exactly two mapping rows link the asset to those entries.
    expect(await observationLinkCount(asset.id)).toBe(2);
  });

  it("a completed job is never re-claimed, so a later tick adds no duplicate entries", async () => {
    const engramId = await insertEngram();
    const asset = await seedPendingAsset(engramId);

    await runMediaTick();
    expect(await statusOf(asset.id)).toBe("completed");
    expect(await allWorldModelRows()).toHaveLength(2);

    // A second tick has nothing pending to claim; it must not re-perceive the
    // already-completed asset (which would double its observations).
    const second = await runMediaTick();
    expect(second.processed).toBe(0);
    expect(h.extractFromMedia).toHaveBeenCalledTimes(1);
    expect(await allWorldModelRows()).toHaveLength(2);
    expect(await observationLinkCount(asset.id)).toBe(2);
  });

  it("marks the job failed (no observations) when the extraction seam throws", async () => {
    const engramId = await insertEngram();
    const asset = await seedPendingAsset(engramId);
    h.extractFromMedia.mockRejectedValueOnce(new Error("vision model unavailable"));

    const result = await runMediaTick();

    expect(result.processed).toBe(1);
    const failed = await reload(asset.id);
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("vision model unavailable");
    // A failed extraction leaves the world model untouched.
    expect(await allWorldModelRows()).toHaveLength(0);
    expect(await observationLinkCount(asset.id)).toBe(0);
  });
});

// --- Concurrency: a claimed job is processed once, never by an overlapping tick --
describe("runMediaTick — overlapping ticks never double-process a job", () => {
  it("a second tick that overlaps an in-flight one does not also process the claimed job", async () => {
    const engramId = await insertEngram();
    const asset = await seedPendingAsset(engramId);

    // Gate the extraction so the first tick suspends mid-process, holding the claim.
    // `started` resolves once the first tick has actually claimed the job and reached
    // the extraction seam — only then is an overlapping tick a genuine race.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let signalStarted!: () => void;
    const started = new Promise<void>((r) => {
      signalStarted = r;
    });
    h.extractFromMedia.mockImplementationOnce(async () => {
      signalStarted();
      await gate;
      return {
        observations: ["A lighthouse blinks twice."],
        summary: "One image.",
        transcript: null,
      };
    });

    const inFlight = runMediaTick(); // claims the asset, suspends in extraction
    await started; // first tick has claimed and is now gated inside extraction
    const overlapping = await runMediaTick(); // re-entrancy guard must bail immediately

    // The overlapping tick processed nothing and never reached the extraction seam
    // a second time — the job is claimed by exactly one tick.
    expect(overlapping.processed).toBe(0);
    expect(h.extractFromMedia).toHaveBeenCalledTimes(1);

    release();
    const first = await inFlight;
    expect(first.processed).toBe(1);

    // The job was perceived exactly once: one completed asset, one set of observations.
    expect(await statusOf(asset.id)).toBe("completed");
    expect(await allWorldModelRows()).toHaveLength(1);
    expect(await observationLinkCount(asset.id)).toBe(1);
  });
});

// --- Stuck-job recovery: recovered, then NOT re-processed -----------------------
describe("runMediaTick — recovers a stuck job without re-processing it", () => {
  it("fails a long-stuck 'processing' job and does not claim/process it that tick", async () => {
    const engramId = await insertEngram();
    // Stuck well past the worker's 5-minute stuck threshold.
    const stuckId = await insertProcessingAsset(
      engramId,
      new Date(Date.now() - 30 * 60_000),
    );

    const result = await runMediaTick();

    // The tick recovered (failed) the wedged job and found nothing pending to claim,
    // so it processed nothing and never invoked the extraction seam.
    expect(result.processed).toBe(0);
    expect(h.extractFromMedia).not.toHaveBeenCalled();

    const recovered = await reload(stuckId);
    expect(recovered.status).toBe("failed");
    expect(recovered.error).toMatch(/timed out/i);
    // A recovered job produces no observations.
    expect(await allWorldModelRows()).toHaveLength(0);
  });

  it("does not re-claim a just-recovered job on the very next tick", async () => {
    const engramId = await insertEngram();
    const stuckId = await insertProcessingAsset(
      engramId,
      new Date(Date.now() - 30 * 60_000),
    );

    await runMediaTick(); // recovers it to failed
    expect(await statusOf(stuckId)).toBe("failed");

    // Recovery FAILS the job (it does not re-queue to pending), so the next tick
    // has nothing to claim — a recovered job is never re-processed.
    const next = await runMediaTick();
    expect(next.processed).toBe(0);
    expect(h.extractFromMedia).not.toHaveBeenCalled();
    expect(await statusOf(stuckId)).toBe("failed");
    expect(await allWorldModelRows()).toHaveLength(0);
  });
});
