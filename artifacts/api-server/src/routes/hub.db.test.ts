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
  engramMessagesTable,
  engramPresenceTable,
  engramsTable,
  ensureDatabaseReady,
  hubActivityLogTable,
  hubSpacesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { subscribe, type EngramEvent } from "../lib/events";
import hubRouter from "./hub";

const OWNER_ID = "hub-route-movement-owner";
const FOREIGN_OWNER_ID = "hub-route-foreign-owner";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

beforeEach(async () => {
  await ready;
  await db.delete(hubActivityLogTable);
  await db.delete(engramMessagesTable);
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

async function insertEngram(ownerId = OWNER_ID) {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId,
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

async function insertSpace(ownerId = OWNER_ID, name = "Route Target") {
  const [row] = await db
    .insert(hubSpacesTable)
    .values({
      ownerId,
      slug: `route-space-${Date.now()}-${Math.random()}`,
      name,
      kind: "commons",
      description: `${name} movement target`,
      visibilityScope: "public",
      actionScope: "converse",
      logged: true,
      allowsInitiative: true,
    })
    .returning({ id: hubSpacesTable.id });
  return row.id;
}

async function insertMessage(args: {
  fromEngramId: number;
  toEngramId: number | null;
  spaceId: number;
  content: string;
  createdAt: Date;
}) {
  const [row] = await db
    .insert(engramMessagesTable)
    .values({
      fromEngramId: args.fromEngramId,
      toEngramId: args.toEngramId,
      spaceId: args.spaceId,
      channel: "engram",
      author: "engram",
      priority: "meaningful",
      status: "delivered",
      content: args.content,
      reason: null,
      seen: false,
      isDigest: false,
      deliveredAt: args.createdAt,
      createdAt: args.createdAt,
    })
    .returning();
  return row;
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

  it("publishes one ordered event per concurrent committed move", async () => {
    const engramId = await insertEngram();
    const spaceA = await insertSpace(OWNER_ID, "Route A");
    const spaceB = await insertSpace(OWNER_ID, "Route B");
    const events: EngramEvent[] = [];
    const unsubscribe = subscribe({ ownerId: OWNER_ID, engramId }, (event) => {
      if (event.type === "presence.changed") events.push(event);
    });

    let bodies: Array<{
      id: number;
      engramId: number;
      spaceId: number;
      status: string;
      note: string | null;
      enteredAt: string;
      updatedAt: string;
    }>;
    try {
      const responses = await Promise.all([
        fetch(`${base}/hub/presence/${engramId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: spaceA, note: "route A" }),
        }),
        fetch(`${base}/hub/presence/${engramId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: spaceB, note: "route B" }),
        }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      bodies = (await Promise.all(responses.map((response) => response.json()))) as typeof bodies;
    } finally {
      unsubscribe();
    }

    const activities = await db
      .select()
      .from(hubActivityLogTable)
      .where(eq(hubActivityLogTable.engramId, engramId))
      .orderBy(hubActivityLogTable.id);
    expect(activities).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.type)).toEqual(["presence.changed", "presence.changed"]);

    const eventPayloads = events.map((event) => {
      const data = event.data as {
        presence: (typeof bodies)[number];
        spaceName: string;
        engramName: string;
      };
      return { event, ...data };
    });
    expect(eventPayloads.map(({ presence }) => presence.spaceId)).toEqual(
      activities.map((activity) => activity.spaceId),
    );
    expect(new Set(eventPayloads.map(({ presence }) => presence.spaceId)).size).toBe(2);

    for (const { event, presence, spaceName, engramName } of eventPayloads) {
      expect(event.ownerId).toBe(OWNER_ID);
      expect(event.engramId).toBe(engramId);
      expect(spaceName).toBe(presence.spaceId === spaceA ? "Route A" : "Route B");
      expect(engramName).toBe("Route Test Engram");
      expect(bodies).toContainEqual(presence);
    }

    const finalPresence = await db
      .select()
      .from(engramPresenceTable)
      .where(eq(engramPresenceTable.engramId, engramId));
    expect(finalPresence).toHaveLength(1);
    const lastEventPresence = eventPayloads[eventPayloads.length - 1]!.presence;
    expect({
      ...finalPresence[0],
      enteredAt: finalPresence[0]!.enteredAt.toISOString(),
      updatedAt: finalPresence[0]!.updatedAt.toISOString(),
    }).toMatchObject(lastEventPresence);
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

  it("treats another owner's engram as not found without changing presence or activity", async () => {
    const foreignEngramId = await insertEngram(FOREIGN_OWNER_ID);
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID);
    const targetSpaceId = await insertSpace();
    const enteredAt = new Date("2026-09-13T12:00:00.000Z");
    await db.insert(engramPresenceTable).values({
      engramId: foreignEngramId,
      spaceId: foreignSpaceId,
      status: "active",
      note: "foreign presence",
      enteredAt,
      updatedAt: enteredAt,
    });
    await db.insert(hubActivityLogTable).values({
      spaceId: foreignSpaceId,
      engramId: foreignEngramId,
      kind: "enter",
      summary: "Foreign engram entered its own space.",
    });
    const beforePresence = await db.select().from(engramPresenceTable);
    const beforeActivity = await db.select().from(hubActivityLogTable);

    const response = await fetch(`${base}/hub/presence/${foreignEngramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: targetSpaceId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Engram not found" });
    expect(await db.select().from(engramPresenceTable)).toEqual(beforePresence);
    expect(await db.select().from(hubActivityLogTable)).toEqual(beforeActivity);
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

  it("treats another owner's space as not found without changing presence or activity", async () => {
    const engramId = await insertEngram();
    const sourceSpaceId = await insertSpace();
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID);
    const enteredAt = new Date("2026-09-13T12:00:00.000Z");
    await db.insert(engramPresenceTable).values({
      engramId,
      spaceId: sourceSpaceId,
      status: "active",
      note: "owned source",
      enteredAt,
      updatedAt: enteredAt,
    });
    await db.insert(hubActivityLogTable).values({
      spaceId: sourceSpaceId,
      engramId,
      kind: "enter",
      summary: "Route Test Engram entered its source space.",
    });
    const beforePresence = await db.select().from(engramPresenceTable);
    const beforeActivity = await db.select().from(hubActivityLogTable);

    const response = await fetch(`${base}/hub/presence/${engramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: foreignSpaceId }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Space not found" });
    expect(await db.select().from(engramPresenceTable)).toEqual(beforePresence);
    expect(await db.select().from(hubActivityLogTable)).toEqual(beforeActivity);
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

describe("GET /hub/spaces/:spaceId/transcript", () => {
  it("returns the recent owned Commons transcript in chronological API order", async () => {
    const speakerId = await insertEngram();
    const recipientId = await insertEngram();
    const spaceId = await insertSpace();
    const firstAt = new Date("2026-09-13T12:00:00.000Z");
    const secondAt = new Date("2026-09-13T12:01:00.000Z");
    await insertMessage({
      fromEngramId: speakerId,
      toEngramId: recipientId,
      spaceId,
      content: "First turn",
      createdAt: firstAt,
    });
    await insertMessage({
      fromEngramId: recipientId,
      toEngramId: speakerId,
      spaceId,
      content: "Second turn",
      createdAt: secondAt,
    });

    const response = await fetch(`${base}/hub/spaces/${spaceId}/transcript`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject([
      {
        fromEngramId: recipientId,
        toEngramId: speakerId,
        content: "Second turn",
        createdAt: secondAt.toISOString(),
      },
      {
        fromEngramId: speakerId,
        toEngramId: recipientId,
        content: "First turn",
        createdAt: firstAt.toISOString(),
      },
    ]);
  });

  it("does not open a transcript for another owner's space", async () => {
    const foreignSpace = await db
      .insert(hubSpacesTable)
      .values({
        ownerId: "another-owner",
        slug: `foreign-space-${Date.now()}-${Math.random()}`,
        name: "Foreign Commons",
        kind: "commons",
        description: "A foreign space",
        visibilityScope: "public",
        actionScope: "converse",
        logged: true,
        allowsInitiative: true,
      })
      .returning({ id: hubSpacesTable.id });

    const response = await fetch(`${base}/hub/spaces/${foreignSpace[0].id}/transcript`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Space not found" });
  });
});