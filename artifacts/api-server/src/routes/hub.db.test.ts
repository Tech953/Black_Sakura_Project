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
import eventsRouter from "./events";

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
    (req as typeof req & { userId: string }).userId = req.header("x-test-owner") ?? OWNER_ID;
    next();
  });
  app.use(hubRouter);
  app.use(eventsRouter);
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

async function insertEngram(ownerId = OWNER_ID, name = "Route Test Engram") {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId,
      slug: `route-movement-${Date.now()}-${Math.random()}`,
      name,
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

function createSseFrameReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";

  return async (): Promise<string | null> => {
    while (true) {
      const frameEnd = buffer.indexOf("\n\n");
      if (frameEnd >= 0) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        return frame;
      }

      const chunk = await reader.read();
      if (chunk.done) {
        buffer += decoder.decode();
        if (buffer.length === 0) return null;
        const frame = buffer;
        buffer = "";
        return frame;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
    }
  };
}

async function readSseFrameWithin(
  readFrame: () => Promise<string | null>,
  description: string,
  timeoutMs = 5_000,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const frame = await Promise.race([
      readFrame(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out waiting for SSE ${description}`)),
          timeoutMs,
        );
      }),
    ]);
    if (frame == null) throw new Error(`SSE stream ended before ${description}`);
    return frame;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function expectIsoTimestamp(value: unknown): void {
  expect(typeof value).toBe("string");
  if (typeof value !== "string") return;
  expect(new Date(value).toISOString()).toBe(value);
}

async function expectNoSseFrame(
  readFrame: () => Promise<string | null>,
  quietMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const nextFrame = readFrame()
    .then((frame) => ({ kind: "frame" as const, frame }))
    .catch((error: unknown) => ({ kind: "error" as const, error }));
  const result = await Promise.race([
    nextFrame,
    new Promise<{ kind: "quiet" }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "quiet" }), quietMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  expect(result).toEqual({ kind: "quiet" });
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

    for (const event of events) {
      expect(event.ownerId).toBe(OWNER_ID);
      const data = event.data as Record<string, unknown>;
      expect(data).toEqual({
        id: persisted!.id,
        paused: expect.any(Boolean),
        quietMode: expect.any(Boolean),
        updatedAt: expect.any(String),
      });
      expectIsoTimestamp(data.updatedAt);
      expectIsoTimestamp(event.ts);
    }

    const finalEvent = events.at(-1);
    expect(finalEvent?.ownerId).toBe(OWNER_ID);
    expect(finalEvent?.data).toEqual({
      id: persisted!.id,
      paused: true,
      quietMode: true,
      updatedAt: persisted!.updatedAt.toISOString(),
    });
  });
});

describe("GET /events controls.changed", () => {
  it("streams the same serialized controls shape as the Hub controls route", async () => {
    const streamResponse = await fetch(`${base}/events`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
    if (!streamResponse.body) throw new Error("SSE response has no body");

    const reader = streamResponse.body.getReader();
    const readFrame = createSseFrameReader(reader);
    try {
      await readSseFrameWithin(readFrame, "retry directive");
      await readSseFrameWithin(readFrame, "connection comment");

      const updateResponse = await fetch(`${base}/hub/controls`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: true, quietMode: true }),
      });
      expect(updateResponse.status).toBe(200);
      const routeControls = await updateResponse.json();

      const frame = await readSseFrameWithin(readFrame, "controls.changed");
      expect(frame.startsWith("data: ")).toBe(true);
      const event = JSON.parse(frame.slice("data: ".length)) as EngramEvent;
      const data = event.data as Record<string, unknown>;

      expect(event.type).toBe("controls.changed");
      expect(event.ownerId).toBe(OWNER_ID);
      expect(data).toEqual(routeControls);
      expect(data).toMatchObject({
        paused: true,
        quietMode: true,
        updatedAt: expect.any(String),
      });
      expectIsoTimestamp(data.updatedAt);
      expectIsoTimestamp(event.ts);
    } finally {
      await reader.cancel().catch(() => undefined);
    }
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

  it("streams both concurrent committed moves over SSE in activity order without duplicates or stale presence", async () => {
    const engramId = await insertEngram();
    const unrelatedEngramId = await insertEngram();
    const spaceA = await insertSpace(OWNER_ID, "SSE Route A");
    const spaceB = await insertSpace(OWNER_ID, "SSE Route B");
    const unrelatedSpace = await insertSpace(OWNER_ID, "Not Subscribed");
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const streamResponse = await fetch(`${base}/events?engramId=${engramId}`, {
        signal: controller.signal,
      });
      expect(streamResponse.status).toBe(200);
      expect(streamResponse.headers.get("content-type")).toContain("text/event-stream");
      if (!streamResponse.body) throw new Error("SSE response has no body");
      reader = streamResponse.body.getReader();
      const readFrame = createSseFrameReader(reader);

      expect(await readSseFrameWithin(readFrame, "retry directive")).toBe("retry: 3000");
      expect(await readSseFrameWithin(readFrame, "connection comment")).toBe(": connected");

      // The stream is scoped to one engram: a same-owner move for another
      // engram must not leak into these SSE frames.
      const unrelatedResponse = await fetch(
        `${base}/hub/presence/${unrelatedEngramId}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: unrelatedSpace, note: "not subscribed" }),
        },
      );
      expect(unrelatedResponse.status).toBe(200);
      await unrelatedResponse.json();

      const responses = await Promise.all([
        fetch(`${base}/hub/presence/${engramId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: spaceA, note: "SSE route A" }),
        }),
        fetch(`${base}/hub/presence/${engramId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spaceId: spaceB, note: "SSE route B" }),
        }),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);

      const bodies = (await Promise.all(responses.map((response) => response.json()))) as Array<{
        id: number;
        engramId: number;
        spaceId: number;
        status: string;
        note: string | null;
        enteredAt: string;
        updatedAt: string;
      }>;
      const events: EngramEvent[] = [];
      for (let index = 0; index < 2; index += 1) {
        const frame = await readSseFrameWithin(readFrame, `presence event ${index + 1}`);
        expect(frame.startsWith("data: ")).toBe(true);
        events.push(JSON.parse(frame.slice("data: ".length)) as EngramEvent);
      }
      await expectNoSseFrame(readFrame, 100);

      const activities = await db
        .select()
        .from(hubActivityLogTable)
        .where(eq(hubActivityLogTable.engramId, engramId))
        .orderBy(hubActivityLogTable.id);
      expect(activities).toHaveLength(2);
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.type)).toEqual([
        "presence.changed",
        "presence.changed",
      ]);
      expect(events.map((event) => event.engramId)).toEqual([engramId, engramId]);

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
        expect(event.ts).toBe(new Date(event.ts).toISOString());
        expect(presence.enteredAt).toBe(new Date(presence.enteredAt).toISOString());
        expect(presence.updatedAt).toBe(new Date(presence.updatedAt).toISOString());
        expect(spaceName).toBe(presence.spaceId === spaceA ? "SSE Route A" : "SSE Route B");
        expect(engramName).toBe("Route Test Engram");
        expect(bodies).toContainEqual(presence);
      }

      const currentResponse = await fetch(`${base}/hub/presence`);
      expect(currentResponse.status).toBe(200);
      const currentPresence = (await currentResponse.json()) as Array<
        (typeof bodies)[number]
      >;
      const finalPresence = currentPresence.find((presence) => presence.engramId === engramId);
      expect(finalPresence).toEqual(eventPayloads[1]!.presence);
    } finally {
      controller.abort();
      await reader?.cancel().catch(() => undefined);
    }
  });

  it("keeps concurrent movement payloads private to each owner's direct and SSE subscribers", async () => {
    const ownerEngramId = await insertEngram(OWNER_ID, "Owner A Engram");
    const foreignEngramId = await insertEngram(FOREIGN_OWNER_ID, "Owner B Engram");
    const ownerSpaceId = await insertSpace(OWNER_ID, "Owner A Private Space");
    const foreignSpaceId = await insertSpace(FOREIGN_OWNER_ID, "Owner B Private Space");
    const ownerController = new AbortController();
    const foreignController = new AbortController();
    const deniedController = new AbortController();
    const ownerEvents: EngramEvent[] = [];
    const foreignEvents: EngramEvent[] = [];
    const unsubscribeOwner = subscribe(
      { ownerId: OWNER_ID, engramId: ownerEngramId },
      (event) => ownerEvents.push(event),
    );
    const unsubscribeForeign = subscribe(
      { ownerId: FOREIGN_OWNER_ID, engramId: foreignEngramId },
      (event) => foreignEvents.push(event),
    );
    let ownerReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let foreignReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const deniedResponse = await fetch(`${base}/events?engramId=${ownerEngramId}`, {
        headers: { "x-test-owner": FOREIGN_OWNER_ID },
        signal: deniedController.signal,
      });
      expect(deniedResponse.status).toBe(404);
      expect(await deniedResponse.json()).toEqual({ error: "Engram not found" });

      const [ownerStream, foreignStream] = await Promise.all([
        fetch(`${base}/events?engramId=${ownerEngramId}`, {
          headers: { "x-test-owner": OWNER_ID },
          signal: ownerController.signal,
        }),
        fetch(`${base}/events?engramId=${foreignEngramId}`, {
          headers: { "x-test-owner": FOREIGN_OWNER_ID },
          signal: foreignController.signal,
        }),
      ]);
      expect([ownerStream.status, foreignStream.status]).toEqual([200, 200]);
      if (!ownerStream.body || !foreignStream.body) {
        throw new Error("An owner SSE response has no body");
      }
      ownerReader = ownerStream.body.getReader();
      foreignReader = foreignStream.body.getReader();
      const readOwnerFrame = createSseFrameReader(ownerReader);
      const readForeignFrame = createSseFrameReader(foreignReader);

      expect(await readSseFrameWithin(readOwnerFrame, "owner A retry directive")).toBe(
        "retry: 3000",
      );
      expect(await readSseFrameWithin(readOwnerFrame, "owner A connection comment")).toBe(
        ": connected",
      );
      expect(await readSseFrameWithin(readForeignFrame, "owner B retry directive")).toBe(
        "retry: 3000",
      );
      expect(await readSseFrameWithin(readForeignFrame, "owner B connection comment")).toBe(
        ": connected",
      );

      const [ownerMoveResponse, foreignMoveResponse] = await Promise.all([
        fetch(`${base}/hub/presence/${ownerEngramId}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-test-owner": OWNER_ID,
          },
          body: JSON.stringify({ spaceId: ownerSpaceId, note: "owner-a-private-presence" }),
        }),
        fetch(`${base}/hub/presence/${foreignEngramId}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            "x-test-owner": FOREIGN_OWNER_ID,
          },
          body: JSON.stringify({ spaceId: foreignSpaceId, note: "owner-b-private-presence" }),
        }),
      ]);
      expect([ownerMoveResponse.status, foreignMoveResponse.status]).toEqual([200, 200]);

      type PresenceBody = {
        id: number;
        engramId: number;
        spaceId: number;
        status: string;
        note: string | null;
        enteredAt: string;
        updatedAt: string;
      };
      const ownerMove = (await ownerMoveResponse.json()) as PresenceBody;
      const foreignMove = (await foreignMoveResponse.json()) as PresenceBody;
      const readEvent = async (
        readFrame: () => Promise<string | null>,
        description: string,
      ): Promise<EngramEvent> => {
        const frame = await readSseFrameWithin(readFrame, description);
        expect(frame.startsWith("data: ")).toBe(true);
        return JSON.parse(frame.slice("data: ".length)) as EngramEvent;
      };
      const [ownerSseEvent, foreignSseEvent] = await Promise.all([
        readEvent(readOwnerFrame, "owner A movement event"),
        readEvent(readForeignFrame, "owner B movement event"),
      ]);
      await Promise.all([
        expectNoSseFrame(readOwnerFrame, 100),
        expectNoSseFrame(readForeignFrame, 100),
      ]);

      expect(ownerEvents).toHaveLength(1);
      expect(foreignEvents).toHaveLength(1);
      expect(ownerEvents[0]).toEqual(ownerSseEvent);
      expect(foreignEvents[0]).toEqual(foreignSseEvent);

      const ownerData = ownerSseEvent.data as {
        presence: PresenceBody;
        spaceName: string;
        engramName: string;
      };
      const foreignData = foreignSseEvent.data as {
        presence: PresenceBody;
        spaceName: string;
        engramName: string;
      };
      expect(ownerSseEvent).toMatchObject({
        type: "presence.changed",
        ownerId: OWNER_ID,
        engramId: ownerEngramId,
      });
      expect(ownerData).toEqual({
        presence: ownerMove,
        spaceName: "Owner A Private Space",
        engramName: "Owner A Engram",
      });
      expect(foreignSseEvent).toMatchObject({
        type: "presence.changed",
        ownerId: FOREIGN_OWNER_ID,
        engramId: foreignEngramId,
      });
      expect(foreignData).toEqual({
        presence: foreignMove,
        spaceName: "Owner B Private Space",
        engramName: "Owner B Engram",
      });

      const serializedOwnerEvent = JSON.stringify(ownerSseEvent);
      const serializedForeignEvent = JSON.stringify(foreignSseEvent);
      expect(serializedOwnerEvent).not.toContain(FOREIGN_OWNER_ID);
      expect(serializedOwnerEvent).not.toContain("Owner B Engram");
      expect(serializedOwnerEvent).not.toContain("Owner B Private Space");
      expect(serializedOwnerEvent).not.toContain("owner-b-private-presence");
      expect(serializedOwnerEvent).not.toContain(JSON.stringify(foreignMove));
      expect(serializedForeignEvent).not.toContain(OWNER_ID);
      expect(serializedForeignEvent).not.toContain("Owner A Engram");
      expect(serializedForeignEvent).not.toContain("Owner A Private Space");
      expect(serializedForeignEvent).not.toContain("owner-a-private-presence");
      expect(serializedForeignEvent).not.toContain(JSON.stringify(ownerMove));
    } finally {
      unsubscribeOwner();
      unsubscribeForeign();
      ownerController.abort();
      foreignController.abort();
      deniedController.abort();
      await ownerReader?.cancel().catch(() => undefined);
      await foreignReader?.cancel().catch(() => undefined);
    }
  });

  it("publishes no presence on an activity-write failure and one committed event after retry", async () => {
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

    const events: EngramEvent[] = [];
    const unsubscribe = subscribe({ ownerId: OWNER_ID, engramId }, (event) => {
      if (event.type === "presence.changed") events.push(event);
    });
    const constraintName = "hub_route_activity_failure_test";
    try {
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

      expect(events).toHaveLength(0);

      const afterFailurePresenceResponse = await fetch(`${base}/hub/presence`);
      const afterFailureActivityResponse = await fetch(`${base}/hub/activity`);
      expect(afterFailurePresenceResponse.status).toBe(200);
      expect(afterFailureActivityResponse.status).toBe(200);
      expect(await afterFailurePresenceResponse.json()).toEqual(beforePresence);
      expect(await afterFailureActivityResponse.json()).toEqual(beforeActivity);

      const retryResponse = await fetch(`${base}/hub/presence/${engramId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          spaceId: targetSpaceId,
          note: "committed after retry",
        }),
      });
      expect(retryResponse.status).toBe(200);
      const retryPresence = (await retryResponse.json()) as {
        id: number;
        engramId: number;
        spaceId: number;
        status: string;
        note: string | null;
        enteredAt: string;
        updatedAt: string;
      };
      expect(retryPresence).toMatchObject({
        engramId,
        spaceId: targetSpaceId,
        status: "active",
        note: "committed after retry",
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "presence.changed",
        ownerId: OWNER_ID,
        engramId,
      });
      expect(events[0]!.data).toEqual({
        presence: retryPresence,
        spaceName: "Route Atomic Target",
        engramName: "Route Test Engram",
      });

      const committedPresence = await db
        .select()
        .from(engramPresenceTable)
        .where(eq(engramPresenceTable.engramId, engramId));
      expect(committedPresence).toHaveLength(1);
      expect({
        ...committedPresence[0],
        enteredAt: committedPresence[0]!.enteredAt.toISOString(),
        updatedAt: committedPresence[0]!.updatedAt.toISOString(),
      }).toMatchObject(retryPresence);
    } finally {
      unsubscribe();
    }
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