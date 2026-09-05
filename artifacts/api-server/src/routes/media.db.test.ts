import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Route-level proof that the upload gates (MIME allowlist + size cap) hold over a
// REAL HTTP listener, REAL multer multipart parsing, REAL Zod/MIME detection, AND
// a REAL embedded Postgres (in-memory PGlite) — not a mocked data layer. This is
// the mirror of `media-store.db.test.ts`: the driver seam in `@workspace/db` reads
// `ENGRAM_DB_DRIVER` at import time, so it must be set *before* the module graph
// loads — `vi.hoisted` runs ahead of all imports. `MEDIA_MAX_BYTES` is likewise
// read by `media.ts` at import time, so shrink the cap here too. Leaving
// `PGLITE_DATA_DIR` unset makes PGlite run purely in-memory.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
  process.env["MEDIA_MAX_BYTES"] = "1024";
});

const TEST_OWNER_ID = "media-route-test-owner";

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
import type { MediaModality } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import mediaRouter from "./media";

// Bring the in-memory schema up before any test runs (migrate only — no seed).
const ready = ensureDatabaseReady({ seed: false });

// --- HTTP harness --------------------------------------------------------------
let server: Server;
let base: string;

beforeAll(async () => {
  await ready;
  const app = express();
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = TEST_OWNER_ID;
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
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await closeDb();
});

beforeEach(async () => {
  // Clear children before parents (FKs). Mirrors the media-store DB harness.
  await db.delete(mediaObservationsTable);
  await db.delete(engramWorldModelTable);
  await db.delete(mediaAssetsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
});

/** Insert a minimal valid engram row so the upload route's FK lookup resolves. */
let engramSeq = 0;
async function insertEngram(): Promise<number> {
  engramSeq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      slug: `upload-engram-${engramSeq}`,
      ownerId: TEST_OWNER_ID,
      name: `Upload Engram ${engramSeq}`,
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

/** Read back every media-asset row currently in the DB. */
async function allAssets(): Promise<
  Array<{ id: number; modality: MediaModality; mimeType: string; sizeBytes: number }>
> {
  return db
    .select({
      id: mediaAssetsTable.id,
      modality: mediaAssetsTable.modality,
      mimeType: mediaAssetsTable.mimeType,
      sizeBytes: mediaAssetsTable.sizeBytes,
    })
    .from(mediaAssetsTable) as Promise<
    Array<{ id: number; modality: MediaModality; mimeType: string; sizeBytes: number }>
  >;
}

async function blobCount(assetId: number): Promise<number> {
  const rows = await db
    .select({ assetId: mediaBlobsTable.assetId })
    .from(mediaBlobsTable)
    .where(eq(mediaBlobsTable.assetId, assetId));
  return rows.length;
}

// --- POST /media (upload gates against a real DB) ------------------------------
describe("POST /media — upload gates against a real PGlite DB", () => {
  it("rejects a disguised (non-allowlisted) MIME with 415 and writes NOTHING to the DB", async () => {
    const engramId = await insertEngram();
    // A zip masquerading with a benign name — only its MIME matters, and it is
    // not on the allowlist, so it must never reach the perception queue.
    const form = new FormData();
    form.append("engramId", String(engramId));
    form.append("file", new Blob(["PK\u0003\u0004"], { type: "application/zip" }), "scene.txt");

    const res = await fetch(`${base}/media`, { method: "POST", body: form });

    expect(res.status).toBe(415);
    // The gate is enforced BEFORE any insert — no asset and no blob landed.
    expect(await allAssets()).toHaveLength(0);
  });

  it("rejects an upload over MEDIA_MAX_BYTES with 413 and writes NOTHING to the DB", async () => {
    const engramId = await insertEngram();
    // MEDIA_MAX_BYTES is 1024 (set in the hoisted block); 2 KiB exceeds it.
    const oversize = "x".repeat(2048);
    const form = new FormData();
    form.append("engramId", String(engramId));
    form.append("file", new Blob([oversize], { type: "text/plain" }), "big.txt");

    const res = await fetch(`${base}/media`, { method: "POST", body: form });

    expect(res.status).toBe(413);
    // Multer aborts before the handler runs — nothing enters the queue.
    expect(await allAssets()).toHaveLength(0);
  });

  it("accepts an allowlisted file: persists a pending asset + blob with the SERVER-derived modality", async () => {
    const engramId = await insertEngram();
    const form = new FormData();
    form.append("engramId", String(engramId));
    // A malicious client tries to mislabel the file; the server must ignore these
    // fields and derive modality/mimeType from the real upload MIME.
    form.append("modality", "video");
    form.append("mimeType", "video/mp4");
    form.append("file", new Blob(["the harbor at dusk"], { type: "text/plain" }), "harbor.txt");

    const res = await fetch(`${base}/media`, { method: "POST", body: form });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: number;
      status: string;
      modality: string;
      mimeType: string;
    };
    expect(body.status).toBe("pending");
    expect(body.modality).toBe("text");
    expect(body.mimeType).toBe("text/plain");

    // The asset really landed in the DB (read back, not from the response) with
    // the server-derived modality — never the spoofed "video" field.
    const assets = await allAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      id: body.id,
      modality: "text",
      mimeType: "text/plain",
    });
    // ...and its raw bytes were stored in the separate blob table.
    expect(await blobCount(body.id)).toBe(1);
  });

  it("derives the modality per-MIME (image/png ⇒ image) for another allowed type", async () => {
    const engramId = await insertEngram();
    const form = new FormData();
    form.append("engramId", String(engramId));
    form.append("file", new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }), "pic.png");

    const res = await fetch(`${base}/media`, { method: "POST", body: form });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: number; modality: string };
    expect(body.modality).toBe("image");
    const assets = await allAssets();
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ id: body.id, modality: "image", mimeType: "image/png" });
  });
});
