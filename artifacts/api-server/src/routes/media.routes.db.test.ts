import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Real-DB route-level test: drives DELETE /api/media/:id through the REAL Express
// router and the REAL media store against an embedded in-memory Postgres (PGlite).
// The driver seam in `@workspace/db` reads `ENGRAM_DB_DRIVER` at import time, so it
// must be set *before* the module graph loads — `vi.hoisted` runs ahead of imports.
// Leaving `PGLITE_DATA_DIR` unset keeps PGlite purely in-memory.
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
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  createMediaAsset,
  appendMediaObservation,
  loadMediaAssetById,
  loadMediaBlob,
} from "../lib/media-store";
import mediaRouter from "./media";

// Bring the in-memory schema up before any test runs (migrate only — no seed).
const ready = ensureDatabaseReady({ seed: false });
const TEST_OWNER_ID = "test_media_route_owner";

// --- HTTP harness ---------------------------------------------------------------
let server: Server;
let base: string;

beforeAll(async () => {
  await ready;
  await db.execute(sql`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__engram_system_template__'`);
  const app = express();
  // Stub the pino-http logger the routes use in error branches.
  app.use((req, _res, next) => {
    req.userId = TEST_OWNER_ID;
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
  await ready;
  await db.execute(sql`ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__engram_system_template__'`);
  // Children before parents (FKs): mapping + world-model rows reference assets/engrams.
  await db.delete(mediaObservationsTable);
  await db.delete(engramWorldModelTable);
  await db.delete(mediaAssetsTable);
  await db.delete(engramsTable);
});

/** Insert a minimal valid engram row so world-model FKs are satisfiable. */
let engramSeq = 0;
async function insertEngram(): Promise<number> {
  engramSeq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      slug: `route-test-engram-${engramSeq}`,
      name: `Route Test Engram ${engramSeq}`,
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

/** All world-model rows currently in the DB. */
async function allWorldModelRows() {
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

async function observationLinkCount(assetId: number): Promise<number> {
  const rows = await db
    .select({ id: mediaObservationsTable.id })
    .from(mediaObservationsTable)
    .where(eq(mediaObservationsTable.assetId, assetId));
  return rows.length;
}

// --- DELETE /media/:id — end-to-end through the real router + real store --------
describe("DELETE /media/:id (real DB, real router, real store)", () => {
  it("removes the asset, its blob, and its mapping rows but PRESERVES the world-model entry", async () => {
    const engramId = await insertEngram();
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

    // Drive the delete through the actual HTTP endpoint the delete button calls.
    const res = await fetch(`${base}/media/${asset.id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    // The file and everything that points back to it is gone...
    expect(await loadMediaAssetById(asset.id)).toBeUndefined();
    expect(await loadMediaBlob(asset.id)).toBeUndefined();
    expect(await observationLinkCount(asset.id)).toBe(0);
    expect(
      await db
        .select({ assetId: mediaBlobsTable.assetId })
        .from(mediaBlobsTable)
        .where(eq(mediaBlobsTable.assetId, asset.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: mediaAssetsTable.id })
        .from(mediaAssetsTable)
        .where(eq(mediaAssetsTable.id, asset.id)),
    ).toHaveLength(0);

    // ...but the OBSERVED memory outlives the file, provenance/source intact.
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

  it("deleting a non-existent asset returns deleted:false and touches no world-model rows", async () => {
    const engramId = await insertEngram();
    const asset = await createMediaAsset({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "keep.txt",
      mimeType: "text/plain",
      modality: "text",
      data: Buffer.from("kept scene"),
    });
    await appendMediaObservation({
      assetId: asset.id,
      engramId,
      content: "kept observation",
      confidence: 0.5,
    });

    const res = await fetch(`${base}/media/999999`, { method: "DELETE" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Media asset not found" });

    // The unrelated asset and its memory are untouched.
    expect(await loadMediaAssetById(asset.id)).toBeDefined();
    expect(await observationLinkCount(asset.id)).toBe(1);
    expect(await allWorldModelRows()).toHaveLength(1);
  });

  it("400s on a non-numeric id without touching anything", async () => {
    const engramId = await insertEngram();
    const asset = await createMediaAsset({
      ownerId: TEST_OWNER_ID,
      engramId,
      filename: "safe.txt",
      mimeType: "text/plain",
      modality: "text",
      data: Buffer.from("safe"),
    });

    const res = await fetch(`${base}/media/not-a-number`, { method: "DELETE" });
    expect(res.status).toBe(400);
    expect(await loadMediaAssetById(asset.id)).toBeDefined();
  });
});
