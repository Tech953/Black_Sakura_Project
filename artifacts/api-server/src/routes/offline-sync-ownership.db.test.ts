import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  closeDb,
  conversations,
  db,
  engramsTable,
  ensureDatabaseReady,
  messages,
  mobileOfflineSyncReceiptsTable,
} from "@workspace/db";
import type { OfflineSyncInput } from "@workspace/api-zod";
import offlineSyncRouter from "./offline-sync";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

const payload: OfflineSyncInput = {
  deviceId: "shared-device-id",
  conversations: [
    {
      syncId: "conversation:1",
      title: "Offline",
      mode: "companion",
      engramSlug: null,
      createdAt: new Date("2026-09-05T12:00:00.000Z"),
      messages: [],
    },
  ],
  inquiries: [],
  transmissions: [],
  observedEntries: [],
  operatorReplies: [],
};

function postAs(ownerId: string, body = payload) {
  return fetch(`${base}/mobile/offline-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer clerk-${ownerId}`,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await ready;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = req.header("authorization") ?? "";
    req.userId = token.startsWith("Bearer clerk-")
      ? token.slice("Bearer clerk-".length)
      : undefined;
    next();
  });
  app.use(offlineSyncRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await ready;
  await db.delete(mobileOfflineSyncReceiptsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
});

describe("offline sync receipt ownership", () => {
  it("keeps the same device and sync IDs idempotent per account", async () => {
    const ownerAFirst = await postAs("owner-a");
    expect(ownerAFirst.status).toBe(200);
    expect(await ownerAFirst.json()).toMatchObject({
      imported: { conversations: 1 },
    });

    const ownerARetry = await postAs("owner-a");
    expect(ownerARetry.status).toBe(200);
    expect(await ownerARetry.json()).toMatchObject({
      imported: { conversations: 0 },
    });

    const ownerBFirst = await postAs("owner-b");
    expect(ownerBFirst.status).toBe(200);
    expect(await ownerBFirst.json()).toMatchObject({
      imported: { conversations: 1 },
    });

    const receipts = await db.select().from(mobileOfflineSyncReceiptsTable);
    expect(receipts).toHaveLength(2);
    expect(receipts.map((row) => row.ownerId).sort()).toEqual([
      "owner-a",
      "owner-b",
    ]);

    const importedConversations = await db.select().from(conversations);
    expect(importedConversations).toHaveLength(2);
    expect(importedConversations.map((row) => row.ownerId).sort()).toEqual([
      "owner-a",
      "owner-b",
    ]);

    const ownerBArchive = await postAs("owner-b", {
      ...payload,
      conversations: [
        {
          ...payload.conversations[0],
          archivedAt: new Date("2026-09-05T13:00:00.000Z"),
        },
      ],
    });
    expect(ownerBArchive.status).toBe(200);

    const isolatedRows = await db.select().from(conversations);
    expect(
      isolatedRows.find((row) => row.ownerId === "owner-a")?.archivedAt,
    ).toBeNull();
    expect(
      isolatedRows.find((row) => row.ownerId === "owner-b")?.archivedAt,
    ).toEqual(new Date("2026-09-05T13:00:00.000Z"));
  });

  it("rejects unauthenticated uploads before validating or storing history", async () => {
    const response = await fetch(`${base}/mobile/offline-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(mobileOfflineSyncReceiptsTable)).toEqual([]);
  });

  it("does not let one account import into another account's engram", async () => {
    await db.insert(engramsTable).values({
      ownerId: "owner-a",
      slug: "private-owner-a",
      name: "Private A",
      title: "Private A",
      symbol: "A",
      origin: "test",
      voiceProfile: {
        speechStyle: "terse",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: {
        valence: 0,
        arousal: 0,
        volatility: 0,
        mood: "even",
      },
      environmentAnchor: {
        name: "Test",
        description: "Test",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: { relationship: "test", facts: [], summary: "" },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: [],
    });

    const response = await postAs("owner-b", {
      ...payload,
      deviceId: "shared-device-id-foreign-engram",
      conversations: [
        {
          ...payload.conversations[0],
          syncId: "conversation:foreign-engram",
          engramSlug: "private-owner-a",
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown engram slug: private-owner-a",
    });
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(mobileOfflineSyncReceiptsTable)).toEqual([]);
  });
});
