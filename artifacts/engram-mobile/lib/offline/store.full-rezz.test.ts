import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
  buildFullRezzEngram: vi.fn(() => ({
    slug: "rebecca-full-rezz",
    name: "Rebecca (Full Rezz)",
    currentMood: "at rest — preserved",
    isArchival: true,
  })),
  transcript: [
    { role: "user" as const, content: "first" },
    { role: "assistant" as const, content: "second" },
    { role: "user" as const, content: "third" },
  ],
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: h.openDatabaseAsync,
}));
vi.mock("@workspace/db/seed/engram-data", () => ({
  engramSeedData: [],
}));
vi.mock("@workspace/db/seed/full-rezz-data", () => ({
  buildFullRezzEngram: h.buildFullRezzEngram,
  FULL_REZZ_BASE_TIMESTAMP_MS: Date.parse("2026-08-03T00:00:00.000Z"),
  FULL_REZZ_CONVERSATION_TITLE: "Full Rezz — Archival Continuity Record",
  FULL_REZZ_SLUG: "rebecca-full-rezz",
  fullRezzTranscript: h.transcript,
}));

type Row = Record<string, unknown>;

function createDatabase(preseeded = false) {
  const state = {
    engrams: [] as Row[],
    conversations: [] as Row[],
    messages: [] as Row[],
  };
  if (preseeded) {
    state.engrams.push({
      id: 1,
      slug: "rebecca-full-rezz",
      data: JSON.stringify({ isArchival: true }),
    });
  }
  const database = {
    execAsync: vi.fn(async () => {}),
    withTransactionAsync: vi.fn(async (fn: () => Promise<void>) => fn()),
    runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("INSERT INTO engrams")) {
        const id = state.engrams.length + 1;
        state.engrams.push({
          id,
          slug: args[0],
          data: args[1],
          currentMood: args[2],
          isChatActive: 0,
          createdAt: args[3],
          updatedAt: args[4],
        });
        return { lastInsertRowId: id, changes: 1 };
      }
      if (sql.includes("INSERT INTO conversations")) {
        const id = state.conversations.length + 1;
        state.conversations.push({
          id,
          title: args[0],
          mode: "companion",
          personaName: "Rebecca (Full Rezz)",
          customEngram: null,
          engramId: args[1],
          createdAt: args[2],
          syncedAt: args[3],
        });
        return { lastInsertRowId: id, changes: 1 };
      }
      if (sql.includes("INSERT INTO messages")) {
        for (let index = 0; index < args.length; index += 5) {
          state.messages.push({
            id: state.messages.length + 1,
            conversationId: args[index],
            role: args[index + 1],
            content: args[index + 2],
            createdAt: args[index + 3],
            syncedAt: args[index + 4],
          });
        }
        return {
          lastInsertRowId: state.messages.length,
          changes: args.length / 5,
        };
      }
      return { lastInsertRowId: 0, changes: 0 };
    }),
    getFirstAsync: vi.fn(async (sql: string, value: unknown) => {
      if (sql.includes("WHERE slug = ?")) {
        return (
          state.engrams.find((row) => row.slug === value) ?? null
        );
      }
      if (sql.includes("SELECT data FROM engrams")) {
        const row = state.engrams.find((candidate) => candidate.id === value);
        return row ? { data: row.data } : null;
      }
      if (sql.includes("SELECT c.id")) {
        const conversation = state.conversations.find(
          (candidate) => candidate.engramId === value,
        );
        return conversation ? { id: conversation.id } : null;
      }
      if (sql.includes("FROM conversations c")) {
        const conversation = state.conversations.find(
          (candidate) => candidate.id === value,
        );
        const engram = state.engrams.find(
          (candidate) => candidate.id === conversation?.engramId,
        );
        return engram ? { data: engram.data } : null;
      }
      return null;
    }),
    getAllAsync: vi.fn(async () => []),
  };
  return { database, state };
}

describe("mobile Full Rezz archive", () => {
  beforeEach(() => {
    vi.resetModules();
    h.openDatabaseAsync.mockReset();
    h.buildFullRezzEngram.mockClear();
  });

  it("seeds every transcript row once, pre-synced and read-only", async () => {
    const { database, state } = createDatabase();
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");

    await store.getDb();
    await store.getDb();

    expect(h.buildFullRezzEngram).toHaveBeenCalledOnce();
    expect(state.engrams).toHaveLength(1);
    expect(JSON.parse(String(state.engrams[0].data))).toMatchObject({
      slug: "rebecca-full-rezz",
      isArchival: true,
    });
    expect(state.conversations).toEqual([
      expect.objectContaining({
        title: "Full Rezz — Archival Continuity Record",
        personaName: "Rebecca (Full Rezz)",
        engramId: 1,
        syncedAt: "2026-08-03T00:00:00.000Z",
      }),
    ]);
    expect(state.messages.map(({ role, content }) => ({ role, content }))).toEqual(
      h.transcript,
    );
    expect(state.messages.map((row) => row.createdAt)).toEqual([
      "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:00:01.000Z",
      "2026-08-03T00:00:02.000Z",
    ]);
    expect(state.messages.every((row) => row.syncedAt === row.createdAt)).toBe(
      true,
    );
    await expect(store.getArchivalConversationId(1)).resolves.toBe(1);
    expect(await store.buildPendingSyncBatch("device-1")).toMatchObject({
      payload: {
        conversations: [],
        inquiries: [],
        transmissions: [],
        observedEntries: [],
      },
    });

    const callsBeforeWrites = database.runAsync.mock.calls.length;
    const archiveError = store.OFFLINE_ARCHIVAL_READ_ONLY_ERROR;
    await expect(store.activateEngram(1)).rejects.toThrow(archiveError);
    await expect(
      store.createConversation({ title: "No", engramId: 1 }),
    ).rejects.toThrow(archiveError);
    await expect(store.appendMessage(1, "user", "No")).rejects.toThrow(
      archiveError,
    );
    await expect(store.removeLastMessage(1, "user", "first")).rejects.toThrow(
      archiveError,
    );
    await expect(
      store.insertInquiry({
        engramId: 1,
        kind: "probe",
        question: "No",
        response: "No",
      }),
    ).rejects.toThrow(archiveError);
    await expect(
      store.insertTransmission({
        engramId: 1,
        kind: "outreach",
        drive: null,
        content: "No",
        mood: null,
      }),
    ).rejects.toThrow(archiveError);
    await expect(store.markTransmissionsSeen(1)).rejects.toThrow(archiveError);
    await expect(
      store.appendObservedEntry({
        engramId: 1,
        content: "No",
        confidence: 1,
        source: "chat:1",
      }),
    ).rejects.toThrow(archiveError);
    expect(database.runAsync).toHaveBeenCalledTimes(callsBeforeWrites);

    database.runAsync.mockClear();
    const syncedAtBefore = {
      conversation: state.conversations[0].syncedAt,
      messages: state.messages.map((row) => row.syncedAt),
    };
    await store.markSyncBatchComplete({
      payload: {
        deviceId: "forged",
        conversations: [],
        inquiries: [],
        transmissions: [],
        observedEntries: [],
      },
      localRows: {
        conversationIds: [1],
        messageIds: state.messages.map((row) => Number(row.id)),
        inquiryIds: [1],
        transmissions: [{ id: 1, syncVersion: 0 }],
        observedEntryIds: [1],
      },
    });
    const syncUpdates = database.runAsync.mock.calls.filter(([sql]) =>
      String(sql).includes("SET syncedAt = ?"),
    );
    expect(syncUpdates).toHaveLength(5);
    expect(
      syncUpdates.every(([sql]) => String(sql).includes("$.isArchival")),
    ).toBe(true);
    expect(state.conversations[0].syncedAt).toBe(syncedAtBefore.conversation);
    expect(state.messages.map((row) => row.syncedAt)).toEqual(
      syncedAtBefore.messages,
    );
  });

  it("does not load the transcript builder when the archive already exists", async () => {
    const { database } = createDatabase(true);
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");

    await store.getDb();

    expect(h.buildFullRezzEngram).not.toHaveBeenCalled();
    expect(database.withTransactionAsync).not.toHaveBeenCalled();
  });
});