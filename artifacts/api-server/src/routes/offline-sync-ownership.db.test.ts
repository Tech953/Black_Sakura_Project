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
  ensureDatabaseReady,
  messages,
  mobileOfflineSyncReceiptsTable,
} from "@workspace/db";
import offlineSyncRouter from "./offline-sync";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

const payload = {
  deviceId: "shared-device-id",
  conversations: [
    {
      syncId: "conversation:1",
      title: "Offline",
      mode: "companion",
      engramSlug: null,
      createdAt: "2026-09-05T12:00:00.000Z",
      messages: [],
    },
  ],
  inquiries: [],
  transmissions: [],
  observedEntries: [],
};

function postAs(ownerId: string) {
  return fetch(`${base}/mobile/offline-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user-id": ownerId,
    },
    body: JSON.stringify(payload),
  });
}

beforeAll(async () => {
  await ready;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = req.header("x-test-user-id")!;
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
  });
});