import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: mocks.openDatabaseAsync,
}));
vi.mock("@workspace/db/seed/engram-data", () => ({
  engramSeedData: [],
}));

let getDb: typeof import("./store").getDb;
let buildPendingSyncBatch: typeof import("./store").buildPendingSyncBatch;
let markSyncBatchComplete: typeof import("./store").markSyncBatchComplete;
let markTransmissionsSeen: typeof import("./store").markTransmissionsSeen;
let MAX_OFFLINE_SYNC_PAYLOAD_BYTES: typeof import("./store").MAX_OFFLINE_SYNC_PAYLOAD_BYTES;

describe("offline SQLite failure harness", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.openDatabaseAsync.mockReset();
    ({
      getDb,
      buildPendingSyncBatch,
      markSyncBatchComplete,
      markTransmissionsSeen,
      MAX_OFFLINE_SYNC_PAYLOAD_BYTES,
    } = await import("./store"));
  });

  it("allows initialization to retry after SQLite open failure", async () => {
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    };
    mocks.openDatabaseAsync
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(database);

    await expect(getDb()).rejects.toThrow("database unavailable");
    await expect(getDb()).resolves.toBe(database);
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("shares SQLite initialization while the first open is still pending", async () => {
    let finish!: () => void;
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    };
    mocks.openDatabaseAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(database);
        }),
    );

    const first = getDb();
    const second = getDb();
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(1);

    finish();
    await expect(first).resolves.toBe(database);
    await expect(second).resolves.toBe(database);
  });

  it("exports stable row IDs and maps local chat observations to conversations", async () => {
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
      getFirstAsync: vi.fn(async () => null),
      getAllAsync: vi.fn(async (sql: string) => {
        if (sql.includes("FROM conversations c")) {
          return [
            {
              id: 7,
              title: "Offline",
              mode: "companion",
              engramSlug: "pyri",
              createdAt: "2026-09-04T12:00:00.000Z",
            },
          ];
        }
        if (sql.includes("FROM messages")) {
          return [
            {
              id: 9,
              role: "user",
              content: "Remember the red door.",
              createdAt: "2026-09-04T12:00:01.000Z",
            },
          ];
        }
        if (sql.includes("FROM world_model w")) {
          return [
            {
              id: 5,
              engramSlug: "pyri",
              content: 'They said: "Remember the red door."',
              confidence: 0.85,
              source: "chat:7",
              createdAt: "2026-09-04T12:00:02.000Z",
            },
          ];
        }
        return [];
      }),
    };
    mocks.openDatabaseAsync.mockResolvedValue(database);

    const batch = await buildPendingSyncBatch("device-1");

    expect(batch.payload).toMatchObject({
      deviceId: "device-1",
      conversations: [
        {
          syncId: "conversation:7",
          messages: [{ syncId: "message:9" }],
        },
      ],
      observedEntries: [
        {
          syncId: "observed:5",
          conversationSyncId: "conversation:7",
        },
      ],
    });
    expect(batch.localRows).toMatchObject({
      conversationIds: [7],
      messageIds: [9],
      observedEntryIds: [5],
    });
    const engramQueries = database.getAllAsync.mock.calls
      .map(([sql]) => String(sql))
      .filter((sql) => sql.includes("JOIN engrams"));
    expect(engramQueries).not.toHaveLength(0);
    expect(
      engramQueries.every((sql) => sql.includes("$.isArchival")),
    ).toBe(true);
  });

  it("defers observations for conversations omitted by the message budget", async () => {
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
      getFirstAsync: vi.fn(async () => null),
      getAllAsync: vi.fn(async (sql: string, conversationId?: number) => {
        if (sql.includes("FROM conversations c")) {
          return [
            {
              id: 1,
              title: "Large",
              mode: "companion",
              engramSlug: "pyri",
              createdAt: "2026-09-04T12:00:00.000Z",
            },
            {
              id: 2,
              title: "Deferred",
              mode: "companion",
              engramSlug: "pyri",
              createdAt: "2026-09-04T12:01:00.000Z",
            },
          ];
        }
        if (sql.includes("FROM messages") && conversationId === 1) {
          return Array.from({ length: 101 }, (_, index) => ({
            id: index + 1,
            role: "user",
            content: `message ${index}`,
            createdAt: "2026-09-04T12:00:01.000Z",
          }));
        }
        if (sql.includes("FROM world_model w")) {
          return [
            {
              id: 5,
              engramSlug: "pyri",
              content: "deferred observation",
              confidence: 0.85,
              source: "chat:2",
              createdAt: "2026-09-04T12:01:02.000Z",
            },
          ];
        }
        return [];
      }),
    };
    mocks.openDatabaseAsync.mockResolvedValue(database);

    const batch = await buildPendingSyncBatch("device-1");

    expect(batch.payload.conversations).toHaveLength(1);
    expect(batch.payload.conversations[0].messages).toHaveLength(100);
    expect(batch.payload.observedEntries).toHaveLength(0);
  });

  it("does not clear a newer transmission mutation after an older snapshot uploads", async () => {
    const transmission = {
      id: 4,
      seen: 0,
      syncedAt: null as string | null,
      syncVersion: 0,
    };
    const database = {
      execAsync: vi.fn(async () => {}),
      getAllAsync: vi.fn(async () => []),
      getFirstAsync: vi.fn(async () => null),
      withTransactionAsync: vi.fn(async (fn: () => Promise<void>) => fn()),
      runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
        if (sql.includes("SET seen = 1")) {
          transmission.seen = 1;
          transmission.syncedAt = null;
          transmission.syncVersion += 1;
          return { lastInsertRowId: 0, changes: 1 };
        }
        if (sql.includes("SET syncedAt = ?") && args[1] === transmission.id) {
          if (args[2] === transmission.syncVersion) {
            transmission.syncedAt = String(args[0]);
            return { lastInsertRowId: 0, changes: 1 };
          }
          return { lastInsertRowId: 0, changes: 0 };
        }
        return { lastInsertRowId: 0, changes: 0 };
      }),
    };
    mocks.openDatabaseAsync.mockResolvedValue(database);
    await getDb();
    const batch = {
      payload: {
        deviceId: "device-1",
        conversations: [],
        inquiries: [],
        transmissions: [],
        observedEntries: [],
      },
      localRows: {
        conversationIds: [],
        messageIds: [],
        inquiryIds: [],
        transmissions: [{ id: 4, syncVersion: 0 }],
        observedEntryIds: [],
      },
    };

    await markTransmissionsSeen(1, [4]);
    await markSyncBatchComplete(batch);

    expect(transmission).toMatchObject({
      seen: 1,
      syncedAt: null,
      syncVersion: 1,
    });
  });

  it("keeps the complete serialized batch below the server body limit", async () => {
    const repeated = "x".repeat(40_000);
    const rows = Array.from({ length: 100 }, (_, index) => index + 1);
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
      getFirstAsync: vi.fn(async () => null),
      getAllAsync: vi.fn(async (sql: string) => {
        if (sql.includes("FROM inquiries i")) {
          return rows.map((id) => ({
            id,
            engramSlug: "pyri",
            kind: "probe",
            question: "Question",
            response: repeated,
            createdAt: "2026-09-04T12:00:00.000Z",
          }));
        }
        if (sql.includes("FROM transmissions t")) {
          return rows.map((id) => ({
            id,
            engramSlug: "pyri",
            kind: "outreach",
            drive: "presence",
            content: repeated,
            mood: null,
            importanceScore: 0.5,
            confidenceScore: 0.5,
            noveltyScore: 0.5,
            overallScore: 0.5,
            wasDelivered: 1,
            seen: 0,
            syncVersion: 0,
            createdAt: "2026-09-04T12:00:00.000Z",
          }));
        }
        if (sql.includes("FROM world_model w")) {
          return rows.map((id) => ({
            id,
            engramSlug: "pyri",
            content: repeated.slice(0, 20_000),
            confidence: 0.85,
            source: null,
            createdAt: "2026-09-04T12:00:00.000Z",
          }));
        }
        return [];
      }),
    };
    mocks.openDatabaseAsync.mockResolvedValue(database);

    const batch = await buildPendingSyncBatch("device-1");
    const bodyBytes = Buffer.byteLength(JSON.stringify(batch.payload), "utf8");

    expect(bodyBytes).toBeLessThanOrEqual(MAX_OFFLINE_SYNC_PAYLOAD_BYTES);
    expect(batch.payload.inquiries.length).toBeGreaterThan(0);
    expect(batch.payload.inquiries.length).toBeLessThan(100);
    expect(batch.payload.transmissions).toHaveLength(0);
    expect(batch.payload.observedEntries).toHaveLength(0);
    expect(batch.localRows.inquiryIds).toHaveLength(
      batch.payload.inquiries.length,
    );
    expect(batch.localRows.transmissions).toHaveLength(0);
    expect(batch.localRows.observedEntryIds).toHaveLength(0);
  });
});