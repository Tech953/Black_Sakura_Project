import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Mocks the data layer (store + db engram lookup) but runs the REAL media router,
// REAL multer multipart parsing, REAL Zod param validation, and REAL MIME→modality
// detection over a real HTTP listener.
const h = vi.hoisted(() => {
  // Shrink the upload cap so the oversize (413) path is testable with a small
  // body. Read by media.ts at import time, so it must be set inside vi.hoisted.
  process.env["MEDIA_MAX_BYTES"] = "1024";
  const state = {
    engram: { id: 3, ownerId: "test-owner", isArchival: false } as
      | { id: number; ownerId: string; isArchival: boolean }
      | undefined,
  };
  const db = {
    select: () => {
      const chain = {
        from() {
          return chain;
        },
        where() {
          return chain;
        },
        limit() {
          return chain;
        },
        then(
          resolve: (value: unknown[]) => unknown,
          reject?: (error: unknown) => unknown,
        ) {
          return Promise.resolve(state.engram ? [state.engram] : []).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return {
    state,
    db,
    createMediaAsset: vi.fn(),
    loadMediaAssets: vi.fn(),
    loadMediaAssetById: vi.fn(),
    loadMediaObservations: vi.fn(),
    loadMediaBlob: vi.fn(),
    requeueMediaAsset: vi.fn(),
    deleteMediaAsset: vi.fn(),
  };
});

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => ({ engramsTable: { id: { __col: "id" } } }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}) }));
vi.mock("../lib/media-store", () => ({
  createMediaAsset: h.createMediaAsset,
  loadMediaAssets: h.loadMediaAssets,
  loadMediaAssetById: h.loadMediaAssetById,
  loadMediaObservations: h.loadMediaObservations,
  loadMediaBlob: h.loadMediaBlob,
  requeueMediaAsset: h.requeueMediaAsset,
  deleteMediaAsset: h.deleteMediaAsset,
}));

import mediaRouter from "./media";

// --- Fixtures ------------------------------------------------------------------
function makeAsset(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-26T00:00:00Z");
  return {
    id: 7,
    ownerId: "test-owner",
    engramId: 3,
    filename: "harbor.txt",
    mimeType: "text/plain",
    modality: "text",
    sizeBytes: 42,
    status: "completed",
    summary: "s",
    commentary: "c",
    transcript: null,
    error: null,
    observationCount: 2,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeObservation() {
  return {
    id: 91,
    provenance: "observed",
    content: "A lighthouse blinks twice.",
    confidence: 0.85,
    scope: "private",
    source: "media:7",
    createdAt: new Date("2026-06-26T00:00:01Z"),
  };
}

// --- HTTP harness --------------------------------------------------------------
let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { userId: string }).userId = "test-owner";
    next();
  });
  // Stub the pino-http logger the routes use in error branches.
  app.use((req, _res, next) => {
    (req as unknown as { log: unknown }).log = {
      error: () => {},
      info: () => {},
      warn: () => {},
    };
    next();
  });
  app.use(mediaRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  h.state.engram = { id: 3, ownerId: "test-owner", isArchival: false };
});

// --- GET /media (list) ---------------------------------------------------------
describe("GET /media", () => {
  it("returns a serialized list of assets", async () => {
    h.loadMediaAssets.mockResolvedValueOnce([makeAsset()]);
    const res = await fetch(`${base}/media?engramId=3`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: 7, engramId: 3, status: "completed" });
    expect(h.loadMediaAssets).toHaveBeenCalledWith({
      ownerId: "test-owner",
      engramId: 3,
      status: undefined,
    });
  });

  it("rejects an invalid status filter with 400", async () => {
    const res = await fetch(`${base}/media?status=bogus`);
    expect(res.status).toBe(400);
    expect(h.loadMediaAssets).not.toHaveBeenCalled();
  });
});

// --- GET /media/:id (detail) ---------------------------------------------------
describe("GET /media/:id", () => {
  it("returns the asset plus its observations", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset());
    h.loadMediaObservations.mockResolvedValueOnce([makeObservation()]);
    const res = await fetch(`${base}/media/7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.asset.id).toBe(7);
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0]).toMatchObject({
      provenance: "observed",
      source: "media:7",
    });
  });

  it("404s when the asset is missing", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(undefined);
    const res = await fetch(`${base}/media/999`);
    expect(res.status).toBe(404);
  });

  it("400s on a non-numeric id", async () => {
    const res = await fetch(`${base}/media/abc`);
    expect(res.status).toBe(400);
    expect(h.loadMediaAssetById).not.toHaveBeenCalled();
  });
});

// --- GET /media/:id/raw --------------------------------------------------------
describe("GET /media/:id/raw", () => {
  it("streams the stored bytes with the stored content type", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset());
    h.loadMediaBlob.mockResolvedValueOnce({
      data: Buffer.from("hello bytes"),
      mimeType: "text/plain",
    });
    const res = await fetch(`${base}/media/7/raw`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("hello bytes");
  });

  it("404s when the bytes are gone", async () => {
    h.loadMediaBlob.mockResolvedValueOnce(undefined);
    const res = await fetch(`${base}/media/7/raw`);
    expect(res.status).toBe(404);
  });
});

// --- POST /media/:id/retry (gated to failed) -----------------------------------
describe("POST /media/:id/retry", () => {
  it("re-queues a failed asset", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset({ status: "failed" }));
    h.requeueMediaAsset.mockResolvedValueOnce(makeAsset({ status: "pending" }));
    const res = await fetch(`${base}/media/7/retry`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("pending");
    expect(h.requeueMediaAsset).toHaveBeenCalledWith(7);
  });

  it("refuses to retry an asset that is not failed (400)", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset({ status: "completed" }));
    const res = await fetch(`${base}/media/7/retry`, { method: "POST" });
    expect(res.status).toBe(400);
    expect(h.requeueMediaAsset).not.toHaveBeenCalled();
  });

  it("409s when a concurrent retry already re-queued it", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset({ status: "failed" }));
    h.requeueMediaAsset.mockResolvedValueOnce(undefined); // lost the race
    const res = await fetch(`${base}/media/7/retry`, { method: "POST" });
    expect(res.status).toBe(409);
  });
});

// --- DELETE /media/:id ---------------------------------------------------------
describe("DELETE /media/:id", () => {
  it("reports whether a row was deleted", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset());
    h.deleteMediaAsset.mockResolvedValueOnce(true);
    const res = await fetch(`${base}/media/7`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });
});

// --- POST /media (multipart upload) --------------------------------------------
describe("POST /media (upload)", () => {
  it("accepts an allowlisted file and creates a pending asset", async () => {
    h.createMediaAsset.mockResolvedValueOnce(makeAsset({ status: "pending" }));
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob(["the harbor"], { type: "text/plain" }), "harbor.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.status).toBe("pending");
    expect(h.createMediaAsset).toHaveBeenCalledTimes(1);
    expect(h.createMediaAsset.mock.calls[0][0]).toMatchObject({
      engramId: 3,
      modality: "text",
      mimeType: "text/plain",
    });
  });

  it("derives modality from the server-side MIME, ignoring a conflicting client-supplied modality field", async () => {
    h.createMediaAsset.mockResolvedValueOnce(makeAsset({ status: "pending" }));
    const form = new FormData();
    form.append("engramId", "3");
    // A malicious client tries to mislabel a text file as a video to slip past
    // the modality gate; the server must ignore this and derive from the MIME.
    form.append("modality", "video");
    form.append("mimeType", "video/mp4");
    form.append("file", new Blob(["the harbor"], { type: "text/plain" }), "harbor.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(h.createMediaAsset).toHaveBeenCalledTimes(1);
    // Modality + mimeType come from the uploaded file's real MIME, never the
    // client-supplied fields.
    expect(h.createMediaAsset.mock.calls[0][0]).toMatchObject({
      engramId: 3,
      modality: "text",
      mimeType: "text/plain",
    });
  });

  it("rejects a non-allowlisted MIME type with 415 (modality comes from the server)", async () => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob(["PK..."], { type: "application/zip" }), "x.zip");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects an upload over the size cap with 413", async () => {
    // MEDIA_MAX_BYTES is 1024 (set in the hoisted block); 2 KiB exceeds it.
    const oversize = "x".repeat(2048);
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob([oversize], { type: "text/plain" }), "big.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(413);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("requires a valid engramId (400)", async () => {
    const form = new FormData();
    form.append("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(400);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("404s when the target engram does not exist", async () => {
    h.state.engram = undefined;
    const form = new FormData();
    form.append("engramId", "999");
    form.append("file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(404);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });
});
