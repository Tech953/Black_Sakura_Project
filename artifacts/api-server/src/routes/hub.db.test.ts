import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Run the actual Hub route against an in-memory Postgres database. The driver
// selection must happen before @workspace/db is imported.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  closeDb,
  db,
  engramPresenceTable,
  engramsTable,
  ensureDatabaseReady,
  hubActivityLogTable,
  hubSpacesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import hubRouter from "./hub";

const OWNER_ID = "hub-route-movement-owner";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

beforeEach(async () => {
  await ready;
  await db.delete(hubActivityLogTable);
  await db.delete(engramPresenceTable);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
});

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = OWNER_ID;
    next();
  });
  app.use(hubRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await closeDb();
});

async function insertEngram() {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: OWNER_ID,
      slug: `route-movement-${Date.now()}-${Math.random()}`,
      name: "Route Test Engram",
      title: "Movement route test",
      symbol: "R",
      origin: "Hub route test",
      voiceProfile: {
        speechStyle: "plain",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "even" },
      environmentAnchor: {
        name: "Test Hub",
        description: "A test space",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: { relationship: "test", facts: [], summary: "" },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

async function insertSpace() {
  const [row] = await db
    .insert(hubSpacesTable)
    .values({
      ownerId: OWNER_ID,
      slug: `route-space-${Date.now()}-${Math.random()}`,
      name: "Route Target",
      kind: "commons",
      description: "A route movement target",
      visibilityScope: "public",
      actionScope: "converse",
      logged: true,
      allowsInitiative: true,
    })
    .returning({ id: hubSpacesTable.id });
  return row.id;
}

describe("PUT /hub/presence/:engramId", () => {
  it("moves an owned engram and serializes timestamps as ISO strings", async () => {
    const engramId = await insertEngram();
    const spaceId = await insertSpace();

    const response = await fetch(`${base}/hub/presence/${engramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId, note: "arrived by route" }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      id: number;
      engramId: number;
      spaceId: number;
      status: string;
      note: string | null;
      enteredAt: string;
      updatedAt: string;
    };
    expect(body).toMatchObject({
      engramId,
      spaceId,
      status: "active",
      note: "arrived by route",
    });
    expect(body.enteredAt).toBe(new Date(body.enteredAt).toISOString());
    expect(body.updatedAt).toBe(new Date(body.updatedAt).toISOString());
    await expect(
      db
        .select()
        .from(engramPresenceTable)
        .where(eq(engramPresenceTable.engramId, engramId)),
    ).resolves.toHaveLength(1);
  });

  it("returns 404 for an unknown engram", async () => {
    const spaceId = await insertSpace();

    const response = await fetch(`${base}/hub/presence/999999`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Engram not found" });
  });

  it("returns 404 for an unknown space", async () => {
    const engramId = await insertEngram();

    const response = await fetch(`${base}/hub/presence/${engramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: 999999 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Space not found" });
  });

  it("returns 400 for an invalid request body", async () => {
    const engramId = await insertEngram();

    const response = await fetch(`${base}/hub/presence/${engramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "missing space id" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
  });
});