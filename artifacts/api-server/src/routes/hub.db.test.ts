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
  hubControlsTable,
  hubActivityLogTable,
  hubSpacesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
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
  await db.delete(hubControlsTable);
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

describe("PUT /hub/controls", () => {
  it("serializes concurrent partial updates and emits the persisted final row", async () => {
    const events: EngramEvent[] = [];
    const unsubscribe = subscribe({ ownerId: OWNER_ID }, (event) => {
      if (event.type === "controls.changed") events.push(event);
    });

    let responses: Response[];
    try {
      responses = await Promise.all([
        fetch(`${base}/hub/controls`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paused: true }),
        }),
        fetch(`${base}/hub/controls`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ quietMode: true }),
        }),
      ]);
    } finally {
      unsubscribe();
    }

    expect(responses.map((response) => response.status)).toEqual([200, 200]);
    expect(events).toHaveLength(2);

    const [persisted] = await db
      .select()
      .from(hubControlsTable)
      .where(eq(hubControlsTable.ownerId, OWNER_ID));
    expect(persisted).toMatchObject({ paused: true, quietMode: true });

    const finalEvent = events.at(-1);
    expect(finalEvent?.ownerId).toBe(OWNER_ID);
    expect(finalEvent?.data).toMatchObject({
      id: persisted!.id,
      paused: persisted!.paused,
      quietMode: persisted!.quietMode,
      updatedAt: persisted!.updatedAt,
    });
  });
});

describe("GET /hub/spaces", () => {
  it("lists only spaces owned by the authenticated owner", async () => {
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID, "Private Foreign Commons");

    const foreignOnlyResponse = await fetch(`${base}/hub/spaces`);
    expect(foreignOnlyResponse.status).toBe(200);
    expect(await foreignOnlyResponse.json()).toEqual([]);

    const ownedSpaceId = await insertSpace(OWNER_ID, "Owner Commons");
    const response = await fetch(`${base}/hub/spaces`);
    const body = (await response.json()) as Array<{ id: number; name: string; description: string }>;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ id: ownedSpaceId, name: "Owner Commons" });
    expect(body.map((space) => space.id)).not.toContain(foreignSpaceId);
    expect(JSON.stringify(body)).not.toContain("Private Foreign Commons");
  });
});

describe("GET /hub/presence", () => {
  it("does not reveal foreign occupants or presence rows in another owner's space", async () => {
    const ownedEngramId = await insertEngram(OWNER_ID);
    const ownedEngramInForeignSpaceId = await insertEngram(OWNER_ID);
    const foreignEngramId = await insertEngram(FOREIGN_OWNER_ID);
    const ownedSpaceId = await insertSpace(OWNER_ID, "Owner Commons");
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID, "Private Foreign Commons");
    const enteredAt = new Date("2026-09-13T12:00:00.000Z");

    await db.insert(engramPresenceTable).values([
      {
        engramId: foreignEngramId,
        spaceId: ownedSpaceId,
        status: "active",
        note: "foreign occupant secret",
        enteredAt,
        updatedAt: enteredAt,
      },
      {
        engramId: ownedEngramInForeignSpaceId,
        spaceId: foreignSpaceId,
        status: "active",
        note: "owner occupant in foreign space",
        enteredAt,
        updatedAt: enteredAt,
      },
    ]);

    const foreignOnlyResponse = await fetch(`${base}/hub/presence`);
    expect(foreignOnlyResponse.status).toBe(200);
    expect(await foreignOnlyResponse.json()).toEqual([]);

    await db.insert(engramPresenceTable).values({
      engramId: ownedEngramId,
      spaceId: ownedSpaceId,
      status: "active",
      note: "owned occupant",
      enteredAt,
      updatedAt: enteredAt,
    });

    const response = await fetch(`${base}/hub/presence`);
    const body = (await response.json()) as Array<{
      engramId: number;
      spaceId: number;
      note: string | null;
    }>;

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      engramId: ownedEngramId,
      spaceId: ownedSpaceId,
      note: "owned occupant",
    });
    expect(JSON.stringify(body)).not.toContain("foreign occupant secret");
    expect(JSON.stringify(body)).not.toContain("owner occupant in foreign space");
    expect(body.map((row) => row.engramId)).not.toContain(foreignEngramId);
  });
});

describe("GET /hub/activity", () => {
  it("returns only summaries attached to owned spaces and engrams", async () => {
    const ownedEngramId = await insertEngram(OWNER_ID);
    const foreignEngramId = await insertEngram(FOREIGN_OWNER_ID);
    const ownedSpaceId = await insertSpace(OWNER_ID, "Owner Commons");
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID, "Private Foreign Commons");

    await db.insert(hubActivityLogTable).values([
      {
        spaceId: ownedSpaceId,
        engramId: foreignEngramId,
        kind: "enter",
        summary: "Foreign engram activity secret",
      },
      {
        spaceId: foreignSpaceId,
        engramId: foreignEngramId,
        kind: "enter",
        summary: "Foreign space activity secret",
      },
    ]);

    const foreignOnlyResponse = await fetch(`${base}/hub/activity`);
    expect(foreignOnlyResponse.status).toBe(200);
    expect(await foreignOnlyResponse.json()).toEqual([]);

    await db.insert(hubActivityLogTable).values([
      {
        spaceId: ownedSpaceId,
        engramId: ownedEngramId,
        kind: "enter",
        summary: "Owned activity summary",
      },
      {
        spaceId: ownedSpaceId,
        engramId: null,
        kind: "system",
        summary: "Owned system activity summary",
      },
    ]);

    const response = await fetch(`${base}/hub/activity`);
    const body = (await response.json()) as Array<{ summary: string }>;

    expect(response.status).toBe(200);
    expect(body.map((row) => row.summary).sort()).toEqual([
      "Owned activity summary",
      "Owned system activity summary",
    ]);
    expect(JSON.stringify(body)).not.toContain("Foreign engram activity secret");
    expect(JSON.stringify(body)).not.toContain("Foreign space activity secret");

    const foreignSpaceResponse = await fetch(`${base}/hub/activity?spaceId=${foreignSpaceId}`);
    expect(foreignSpaceResponse.status).toBe(404);
    const foreignSpaceBody = await foreignSpaceResponse.json();
    expect(foreignSpaceBody).toEqual({ error: "Space not found" });
    expect(JSON.stringify(foreignSpaceBody)).not.toContain("Foreign space activity secret");
  });
});

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

  it("returns a stable failure when activity logging fails without changing Hub reads", async () => {
    const engramId = await insertEngram();
    const sourceSpaceId = await insertSpace(OWNER_ID, "Route Atomic Source");
    const targetSpaceId = await insertSpace(OWNER_ID, "Route Atomic Target");

    const initialResponse = await fetch(`${base}/hub/presence/${engramId}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ spaceId: sourceSpaceId, note: "before failed route move" }),
    });
    expect(initialResponse.status).toBe(200);

    const beforePresenceResponse = await fetch(`${base}/hub/presence`);
    const beforeActivityResponse = await fetch(`${base}/hub/activity`);
    expect(beforePresenceResponse.status).toBe(200);
    expect(beforeActivityResponse.status).toBe(200);
    const beforePresence = await beforePresenceResponse.json();
    const beforeActivity = await beforeActivityResponse.json();

    const constraintName = "hub_route_activity_failure_test";
    await db.execute(
      sql.raw(
        `ALTER TABLE "hub_activity_log" ADD CONSTRAINT "${constraintName}" CHECK (summary <> 'Route Test Engram moved from Route Atomic Source to Route Atomic Target.')`,
      ),
    );
    try {
      const failedResponse = await fetch(`${base}/hub/presence/${engramId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spaceId: targetSpaceId, note: "should not persist" }),
      });

      expect(failedResponse.status).toBe(500);
      expect(await failedResponse.json()).toEqual({ error: "Could not move engram." });
    } finally {
      await db.execute(
        sql.raw(`ALTER TABLE "hub_activity_log" DROP CONSTRAINT "${constraintName}"`),
      );
    }

    const afterPresenceResponse = await fetch(`${base}/hub/presence`);
    const afterActivityResponse = await fetch(`${base}/hub/activity`);
    expect(afterPresenceResponse.status).toBe(200);
    expect(afterActivityResponse.status).toBe(200);
    expect(await afterPresenceResponse.json()).toEqual(beforePresence);
    expect(await afterActivityResponse.json()).toEqual(beforeActivity);
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
    const foreignSpeakerId = await insertEngram(FOREIGN_OWNER_ID);
    const foreignRecipientId = await insertEngram(FOREIGN_OWNER_ID);
    const spaceId = await insertSpace();
    const firstAt = new Date("2026-09-13T12:00:00.000Z");
    const secondAt = new Date("2026-09-13T12:01:00.000Z");
    const foreignAt = new Date("2026-09-13T12:02:00.000Z");
    const foreignRecipientAt = new Date("2026-09-13T12:03:00.000Z");
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
    await insertMessage({
      fromEngramId: foreignSpeakerId,
      toEngramId: null,
      spaceId,
      content: "Foreign participant transcript secret",
      createdAt: foreignAt,
    });
    await insertMessage({
      fromEngramId: speakerId,
      toEngramId: foreignRecipientId,
      spaceId,
      content: "Foreign recipient transcript secret",
      createdAt: foreignRecipientAt,
    });

    const response = await fetch(`${base}/hub/spaces/${spaceId}/transcript`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(2);
    expect(body).toMatchObject([
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
    expect(JSON.stringify(body)).not.toContain("Foreign participant transcript secret");
    expect(JSON.stringify(body)).not.toContain("Foreign recipient transcript secret");
  });

  it("does not open a transcript for another owner's space", async () => {
    const foreignSpeakerId = await insertEngram(FOREIGN_OWNER_ID);
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID, "Private Foreign Commons");
    await insertMessage({
      fromEngramId: foreignSpeakerId,
      toEngramId: null,
      spaceId: foreignSpaceId,
      content: "Foreign Commons transcript secret",
      createdAt: new Date("2026-09-13T12:00:00.000Z"),
    });

    const response = await fetch(`${base}/hub/spaces/${foreignSpaceId}/transcript`);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Space not found" });
    expect(JSON.stringify(body)).not.toContain("Private Foreign Commons");
    expect(JSON.stringify(body)).not.toContain("Foreign Commons transcript secret");
  });
});