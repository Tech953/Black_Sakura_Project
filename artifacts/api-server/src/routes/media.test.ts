import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
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
  MEDIA_RECOVERY_ERROR: "Processing timed out and was recovered.",
}));

import mediaRouter from "./media";
import { encodeStoredMediaFailure } from "../lib/media-failure";

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

function isoBox(type: string, payload: Buffer): Buffer {
  const box = Buffer.alloc(8);
  box.writeUInt32BE(8 + payload.length, 0);
  box.write(type, 4, 4, "ascii");
  return Buffer.concat([box, payload]);
}

function validMp3(): Buffer {
  const bytes = Buffer.alloc(417);
  bytes.set([0xff, 0xfb, 0x90, 0x64]);
  return bytes;
}

function validMp4(): Buffer {
  return Buffer.concat([
    isoBox("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isom")])),
    isoBox("moov", isoBox("mvhd", Buffer.alloc(4))),
    isoBox("mdat", Buffer.from([0])),
  ]);
}

const validJpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAgAAAQABAAD//gAQTGF2YzYwLjMxLjEwMgD/2wBDAAgEBAQEBAUFBQUFBQYGBgYGBgYGBgYGBgYHBwcICAgHBwcGBgcHCAgICAkJCQgICAgJCQoKCgwMCwsODg4RERT/xABLAAEBAAAAAAAAAAAAAAAAAAAACAEBAAAAAAAAAAAAAAAAAAAAABABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIAAIAAgMBIgACEQADEQD/2gAMAwEAAhEDEQA/AJ/AB//Z",
  "base64",
);
const validPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAADUExURf8AABniCTcAAAAMSURBVAjXY2BgYAAAAAQAASc0JwoAAAAASUVORK5CYII=",
  "base64",
);
const validWebp = Buffer.from(
  "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAgA0JaACdLoB+AADsAD+8MQL/yC5YXXI1/8gP+QH/ID/+PIAAAA=",
  "base64",
);
const validGif = Buffer.from(
  "R0lGODlhAgACAPAAAP8AAAAAACH5BAAAAAAALAAAAAACAAIAAAIChFEAOw==",
  "base64",
);
const invalidPngChunkLength = Buffer.from(validPng);
invalidPngChunkLength.writeUInt32BE(0xffffffff, 8);
const invalidWebpChunkLength = Buffer.from(validWebp);
invalidWebpChunkLength.writeUInt32LE(0xffffffff, 16);
const invalidGifBlockLength = Buffer.from(validGif);
const gifImageSeparator = invalidGifBlockLength.indexOf(0x2c, 13);
invalidGifBlockLength[gifImageSeparator + 11] = 0xff;

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
  h.loadMediaBlob.mockReset();
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
    expect(body[0]).toMatchObject({
      id: 7,
      engramId: 3,
      status: "completed",
      resultState: "complete",
    });
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
    expect(body.asset.resultState).toBe("complete");
    expect(body.observations).toHaveLength(1);
    expect(body.observations[0]).toMatchObject({
      provenance: "observed",
      source: "media:7",
    });
  });

  it("serializes a failed asset with observations as a partial result", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(
      makeAsset({ status: "failed", observationCount: 1 }),
    );
    h.loadMediaObservations.mockResolvedValueOnce([makeObservation()]);

    const res = await fetch(`${base}/media/7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.asset.resultState).toBe("partial");
    expect(body.asset.observationCount).toBe(1);
  });

  it("marks a recovered timeout with a distinct failure kind", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(
      makeAsset({
        status: "failed",
        error: "Processing timed out and was recovered.",
        observationCount: 0,
      }),
    );
    h.loadMediaObservations.mockResolvedValueOnce([]);

    const res = await fetch(`${base}/media/7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.asset.failureKind).toBe("recovered");
    expect(body.asset.resultState).toBe("none");
  });

  it.each([
    ["provider", "The provider is rate-limiting this request."],
    ["extraction", "Could not decode the source file."],
  ] as const)(
    "exposes the %s category and keeps the diagnostic separate",
    async (failureKind, diagnostic) => {
      h.loadMediaAssetById.mockResolvedValueOnce(
        makeAsset({
          status: "failed",
          error: encodeStoredMediaFailure(failureKind, diagnostic),
          observationCount: 0,
        }),
      );
      h.loadMediaObservations.mockResolvedValueOnce([]);

      const res = await fetch(`${base}/media/7`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.asset.failureKind).toBe(failureKind);
      expect(body.asset.error).toBe(diagnostic);
      expect(body.asset.resultState).toBe("none");
    },
  );

  it("preserves legacy unclassified diagnostics", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(
      makeAsset({ status: "failed", error: "Unexpected database error" }),
    );
    h.loadMediaObservations.mockResolvedValueOnce([]);

    const res = await fetch(`${base}/media/7`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.asset.failureKind).toBeNull();
    expect(body.asset.error).toBe("Unexpected database error");
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
    h.loadMediaBlob.mockResolvedValueOnce({
      data: Buffer.from("the harbor"),
      mimeType: "text/plain",
    });
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
    h.loadMediaBlob.mockResolvedValueOnce({
      data: Buffer.from("the harbor"),
      mimeType: "text/plain",
    });
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
  it("does not create an asset when the multipart client disconnects mid-upload", async () => {
    const boundary = "media-cancel-test";
    const request = httpRequest(base, {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
    });
    request.on("error", () => {});
    request.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="engramId"\r\n\r\n3\r\n`,
    );
    request.write(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n`,
    );
    request.write("part of a file");
    request.destroy();

    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

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

  it("canonicalizes a parameterized MIME header before storing it", async () => {
    h.createMediaAsset.mockResolvedValueOnce(
      makeAsset({ status: "pending", mimeType: "text/plain" }),
    );
    const form = new FormData();
    form.append("engramId", "3");
    form.append(
      "file",
      new Blob(["the harbor"], { type: "text/plain; charset=utf-8" }),
      "harbor.txt",
    );
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(h.createMediaAsset.mock.calls[0][0]).toMatchObject({
      mimeType: "text/plain",
      modality: "text",
    });
  });

  it("canonicalizes an image MIME alias before storing it", async () => {
    h.createMediaAsset.mockResolvedValueOnce(
      makeAsset({ status: "pending", filename: "scene.jpg", mimeType: "image/jpeg", modality: "image" }),
    );
    const form = new FormData();
    form.append("engramId", "3");
    form.append(
      "file",
      new Blob([validJpeg], { type: "image/jpg" }),
      "scene.jpg",
    );
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(h.createMediaAsset.mock.calls[0][0]).toMatchObject({
      mimeType: "image/jpeg",
      modality: "image",
    });
  });

  it("rejects a generic MIME header instead of guessing from the filename", async () => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob(["the harbor"], { type: "application/octet-stream" }), "harbor.txt");
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({
      error: "Unsupported media type: application/octet-stream",
    });
    expect(h.createMediaAsset).not.toHaveBeenCalled();
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

  it.each([
    {
      mime: "image/png",
      filename: "scene.png",
      bytes: validPng,
      modality: "image",
    },
    {
      mime: "image/webp",
      filename: "scene.webp",
      bytes: validWebp,
      modality: "image",
    },
    {
      mime: "image/gif",
      filename: "scene.gif",
      bytes: validGif,
      modality: "image",
    },
    {
      mime: "audio/mpeg",
      filename: "log.mp3",
      bytes: validMp3(),
      modality: "audio",
    },
    {
      mime: "video/mp4",
      filename: "clip.mp4",
      bytes: validMp4(),
      modality: "video",
    },
  ])("accepts a valid $modality signature", async ({ mime, filename, bytes, modality }) => {
    h.createMediaAsset.mockResolvedValueOnce(
      makeAsset({ status: "pending", filename, mimeType: mime, modality }),
    );
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob([Uint8Array.from(bytes)], { type: mime }), filename);
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(201);
    expect(h.createMediaAsset.mock.calls[0][0]).toMatchObject({ mimeType: mime, modality });
  });

  it("rejects bytes whose signature does not match an allowlisted claimed MIME", async () => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append(
      "file",
      new Blob(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        { type: "text/plain" },
      ),
      "not-text.txt",
    );
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("do not match") });
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("rejects a filename extension that contradicts the claimed MIME", async () => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append(
      "file",
      new Blob(["the harbor"], { type: "text/plain" }),
      "harbor.png",
    );
    const res = await fetch(`${base}/media`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("filename extension"),
    });
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("requires valid JSON bytes when the claimed type is application/json", async () => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append(
      "file",
      new Blob(["not actually json"], { type: "application/json" }),
      "fake.json",
    );
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it.each([
    ["truncated WAV", "audio/wav", "broken.wav", Buffer.from("RIFF\xff\xff\xff\xffWAVEfmt ")],
    ["truncated Ogg", "audio/ogg", "broken.ogg", Buffer.from("OggS\x00\x02")],
    [
      "truncated WebM",
      "video/webm",
      "broken.webm",
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x00]),
    ],
    [
      "truncated QuickTime",
      "video/quicktime",
      "broken.mov",
      Buffer.from([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]),
    ],
    [
      "truncated Matroska",
      "video/x-matroska",
      "broken.mkv",
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x81, 0x00]),
    ],
    ["truncated JPEG", "image/jpeg", "broken.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])],
    ["truncated PNG", "image/png", "broken.png", validPng.subarray(0, -1)],
    ["invalid PNG chunk length", "image/png", "broken.png", invalidPngChunkLength],
    ["truncated WebP", "image/webp", "broken.webp", validWebp.subarray(0, -1)],
    ["invalid WebP chunk length", "image/webp", "broken.webp", invalidWebpChunkLength],
    ["truncated GIF", "image/gif", "broken.gif", validGif.subarray(0, -1)],
    ["invalid GIF block length", "image/gif", "broken.gif", invalidGifBlockLength],
  ])("rejects a %s at upload with 415", async (_label, mime, filename, bytes) => {
    const form = new FormData();
    form.append("engramId", "3");
    form.append("file", new Blob([bytes], { type: mime }), filename);
    const res = await fetch(`${base}/media`, { method: "POST", body: form });
    expect(res.status).toBe(415);
    expect(h.createMediaAsset).not.toHaveBeenCalled();
  });

  it("does not preview a stored asset that no longer passes validation", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(makeAsset());
    h.loadMediaBlob.mockResolvedValueOnce({
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      mimeType: "text/plain",
    });
    const res = await fetch(`${base}/media/7/raw`);
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("failed upload validation"),
    });
  });

  it("does not retry a stored asset that no longer passes validation", async () => {
    h.loadMediaAssetById.mockResolvedValueOnce(
      makeAsset({ status: "failed", filename: "harbor.png" }),
    );
    h.loadMediaBlob.mockResolvedValueOnce({
      data: Buffer.from("the harbor"),
      mimeType: "text/plain",
    });
    const res = await fetch(`${base}/media/7/retry`, { method: "POST" });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("failed upload validation"),
    });
    expect(h.requeueMediaAsset).not.toHaveBeenCalled();
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
