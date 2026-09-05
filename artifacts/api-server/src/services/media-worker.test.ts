import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Engram, MediaAsset } from "@workspace/db";

// --- Hoisted mock state (db + every collaborator the worker reaches) -----------
const h = vi.hoisted(() => {
  const engramsTable = { __table: "engrams" } as Record<string, unknown>;
  const state = { engram: null as unknown };

  // loadEngram does: db.select().from(engramsTable).where(eq(...)) -> [row]
  const db = {
    select: () => {
      const chain = {
        from() {
          return chain;
        },
        where() {
          return Promise.resolve(state.engram ? [state.engram] : []);
        },
      };
      return chain;
    },
  };

  return {
    engramsTable,
    state,
    db,
    claimNextPendingJob: vi.fn(),
    loadMediaBlob: vi.fn(),
    updateMediaAsset: vi.fn(
      async (_id: number, _patch: Record<string, unknown>) => undefined,
    ),
    appendMediaObservation: vi.fn(async () => ({ id: 1 })),
    clearMediaObservations: vi.fn(async () => undefined),
    upsertMediaContextMessage: vi.fn(
      async (_asset: MediaAsset, _content: string) => undefined,
    ),
    recoverStuckJobs: vi.fn(async () => 0),
    extractFromMedia: vi.fn(),
    generateMediaCommentary: vi.fn(async () => "in-voice reaction"),
    summarizeWorldModel: vi.fn(() => "wm summary"),
    loadRecentWorldModel: vi.fn(async () => []),
  };
});

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => ({ engramsTable: h.engramsTable }));
vi.mock("drizzle-orm", () => ({ and: () => ({}), eq: () => ({}) }));
vi.mock("../lib/account-bootstrap", () => ({
  loadOwnedConversation: vi.fn(async () => ({ id: 1 })),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/media-store", () => ({
  claimNextPendingJob: h.claimNextPendingJob,
  loadMediaBlob: h.loadMediaBlob,
  updateMediaAsset: h.updateMediaAsset,
  appendMediaObservation: h.appendMediaObservation,
  clearMediaObservations: h.clearMediaObservations,
  upsertMediaContextMessage: h.upsertMediaContextMessage,
  recoverStuckJobs: h.recoverStuckJobs,
}));
vi.mock("../lib/media-extraction", () => ({ extractFromMedia: h.extractFromMedia }));
vi.mock("../lib/engram-generation", () => ({
  generateMediaCommentary: h.generateMediaCommentary,
}));
vi.mock("../lib/world-model", () => ({ summarizeWorldModel: h.summarizeWorldModel }));
vi.mock("../lib/world-model-store", () => ({
  loadRecentWorldModel: h.loadRecentWorldModel,
}));

import { runMediaTick } from "./media-worker";

// --- Fixtures ------------------------------------------------------------------
function makeAsset(overrides: Partial<MediaAsset> = {}): MediaAsset {
  return {
    id: 7,
    ownerId: "test_media_worker_owner",
    engramId: 3,
    filename: "harbor.txt",
    mimeType: "text/plain",
    modality: "text",
    sizeBytes: 42,
    status: "processing",
    summary: null,
    commentary: null,
    transcript: null,
    error: null,
    observationCount: 0,
    startedAt: new Date("2026-06-26T00:00:00Z"),
    completedAt: null,
    createdAt: new Date("2026-06-26T00:00:00Z"),
    updatedAt: new Date("2026-06-26T00:00:00Z"),
    ...overrides,
  } as MediaAsset;
}

function makeEngram(): Engram {
  return { id: 3, name: "Arezo", ownerId: "test_media_worker_owner" } as Engram;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.engram = makeEngram();
  h.claimNextPendingJob.mockResolvedValue(undefined);
  h.loadMediaBlob.mockResolvedValue({ data: Buffer.from("payload"), mimeType: "text/plain" });
  h.extractFromMedia.mockResolvedValue({
    observations: ["A lighthouse blinks twice.", "A gull settles on the rail."],
    summary: "Two short images of a harbor.",
    transcript: null,
  });
  h.recoverStuckJobs.mockResolvedValue(0);
  h.updateMediaAsset.mockResolvedValue(undefined);
  h.appendMediaObservation.mockResolvedValue({ id: 1 });
  h.generateMediaCommentary.mockResolvedValue("in-voice reaction");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Idle tick -----------------------------------------------------------------
describe("runMediaTick — no pending work", () => {
  it("still recovers stuck jobs but does no extraction when the queue is empty", async () => {
    const result = await runMediaTick();
    expect(result.processed).toBe(0);
    expect(h.recoverStuckJobs).toHaveBeenCalledTimes(1);
    expect(h.claimNextPendingJob).toHaveBeenCalledTimes(1);
    expect(h.extractFromMedia).not.toHaveBeenCalled();
    expect(h.updateMediaAsset).not.toHaveBeenCalled();
  });
});

// --- Happy path: pending -> processing -> completed ----------------------------
describe("runMediaTick — completes a claimed job", () => {
  it("writes one OBSERVED observation per non-empty line, then marks completed", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());

    const result = await runMediaTick();

    expect(result.processed).toBe(1);
    expect(h.appendMediaObservation).toHaveBeenCalledTimes(2);
    // The worker passes asset/engram ids straight through; provenance + source are
    // fixed inside the store (asserted separately in media-store.test.ts).
    expect(h.appendMediaObservation).toHaveBeenNthCalledWith(1, {
      assetId: 7,
      engramId: 3,
      content: "A lighthouse blinks twice.",
      confidence: 0.85,
    });
    expect(h.generateMediaCommentary).toHaveBeenCalledTimes(1);

    expect(h.updateMediaAsset).toHaveBeenCalledTimes(1);
    const [id, patch] = h.updateMediaAsset.mock.calls[0];
    expect(id).toBe(7);
    expect(patch).toMatchObject({
      status: "completed",
      summary: "Two short images of a harbor.",
      transcript: null,
      commentary: "in-voice reaction",
      observationCount: 2,
      error: null,
    });
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it("skips blank observation lines so observationCount reflects only real entries", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.extractFromMedia.mockResolvedValueOnce({
      observations: ["real one", "   ", ""],
      summary: "s",
      transcript: null,
    });

    await runMediaTick();

    expect(h.appendMediaObservation).toHaveBeenCalledTimes(1);
    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.observationCount).toBe(1);
    expect(patch.status).toBe("completed");
  });
});

// --- Inline chat upload: surface a context message in the thread ---------------
describe("runMediaTick — conversation-bound (inline) uploads", () => {
  it("upserts a context message carrying the summary when conversationId is set", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset({ conversationId: 9 }));

    await runMediaTick();

    expect(h.upsertMediaContextMessage).toHaveBeenCalledTimes(1);
    const [asset, content] = h.upsertMediaContextMessage.mock.calls[0];
    expect(asset).toMatchObject({ id: 7, conversationId: 9 });
    expect(content).toContain("Two short images of a harbor.");
    expect(content).toContain("harbor.txt");
  });

  it("does NOT upsert a context message for a non-conversation-bound asset", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset({ conversationId: null }));

    await runMediaTick();

    expect(h.upsertMediaContextMessage).not.toHaveBeenCalled();
  });
});

// --- Idempotency: a retry replaces, never duplicates ---------------------------
describe("runMediaTick — idempotent (re)processing", () => {
  it("clears any prior observations for the asset before writing the fresh set", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());

    await runMediaTick();

    expect(h.clearMediaObservations).toHaveBeenCalledTimes(1);
    expect(h.clearMediaObservations).toHaveBeenCalledWith(7);
    // The clear must happen BEFORE the first observation is appended, otherwise a
    // retry would stack duplicate entries on top of a prior partial run.
    const clearOrder = h.clearMediaObservations.mock.invocationCallOrder[0];
    const firstAppendOrder = h.appendMediaObservation.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(firstAppendOrder);
  });

  it("does not clear when the blob is missing (nothing was going to be written)", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.loadMediaBlob.mockResolvedValueOnce(undefined);

    await runMediaTick();

    expect(h.clearMediaObservations).not.toHaveBeenCalled();
  });
});

// --- Failure surfaces ----------------------------------------------------------
describe("runMediaTick — failures surface on the job", () => {
  it("marks the job failed (not completed) when extraction throws", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.extractFromMedia.mockRejectedValueOnce(new Error("vision model unavailable"));

    const result = await runMediaTick();

    expect(result.processed).toBe(1);
    expect(h.appendMediaObservation).not.toHaveBeenCalled();
    expect(h.updateMediaAsset).toHaveBeenCalledTimes(1);
    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect(patch.error).toContain("vision model unavailable");
    expect(patch.completedAt).toBeInstanceOf(Date);
  });

  it("fails the job when the blob bytes are missing", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.loadMediaBlob.mockResolvedValueOnce(undefined);

    await runMediaTick();

    expect(h.extractFromMedia).not.toHaveBeenCalled();
    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect(patch.error).toMatch(/missing/i);
  });

  it("truncates very long error messages to 500 chars", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.extractFromMedia.mockRejectedValueOnce(new Error("x".repeat(2000)));

    await runMediaTick();

    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect((patch.error as string).length).toBe(500);
  });
});

// --- Commentary is best-effort -------------------------------------------------
describe("runMediaTick — commentary is best-effort", () => {
  it("still completes the job (observations intact) when commentary generation throws", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.generateMediaCommentary.mockRejectedValueOnce(new Error("llm down"));

    const result = await runMediaTick();

    expect(result.processed).toBe(1);
    expect(h.appendMediaObservation).toHaveBeenCalledTimes(2);
    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.status).toBe("completed");
    expect(patch.commentary).toBeNull();
    expect(patch.observationCount).toBe(2);
  });

  it("fails the job when the owner-scoped engram no longer exists", async () => {
    h.claimNextPendingJob.mockResolvedValueOnce(makeAsset());
    h.state.engram = null;

    await runMediaTick();

    expect(h.generateMediaCommentary).not.toHaveBeenCalled();
    const [, patch] = h.updateMediaAsset.mock.calls[0];
    expect(patch.status).toBe("failed");
    expect(patch.error).toMatch(/owner/i);
  });
});

// --- Concurrency: one job per tick, no overlap ---------------------------------
describe("runMediaTick — re-entrancy guard", () => {
  it("claims at most one job per tick", async () => {
    h.claimNextPendingJob.mockResolvedValue(makeAsset());

    await runMediaTick();

    expect(h.claimNextPendingJob).toHaveBeenCalledTimes(1);
    expect(h.updateMediaAsset).toHaveBeenCalledTimes(1);
  });

  it("no-ops an overlapping tick while a long extraction is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.claimNextPendingJob.mockResolvedValue(makeAsset());
    h.extractFromMedia.mockImplementationOnce(async () => {
      await gate;
      return { observations: ["late"], summary: "s", transcript: null };
    });

    const inFlight = runMediaTick(); // starts, suspends inside extraction
    const overlapping = await runMediaTick(); // guard should bail immediately

    expect(overlapping.processed).toBe(0);

    release();
    const first = await inFlight;
    expect(first.processed).toBe(1);
    // Only the first tick's job ran end-to-end.
    expect(h.updateMediaAsset).toHaveBeenCalledTimes(1);
  });
});
