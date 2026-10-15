import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
  buildFullRezzEngram: vi.fn(() => ({
    slug: "rebecca-full-rezz",
    name: "Rebecca (Full Rezz)",
    currentMood: "at rest — preserved",
    isArchival: true,
  })),
  buildLiveFullRezzEngram: vi.fn(() => ({
    slug: "rebecca-full-rezz-live",
    name: "Rebecca (Full Rezz · Live)",
    title: "Interactive continuation from the preserved Full Rezz record",
    currentMood: "present",
    isArchival: false,
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
vi.mock("@workspace/db/seed/full-rezz-live-data", () => ({
  buildLiveFullRezzEngram: h.buildLiveFullRezzEngram,
  LIVE_FULL_REZZ_CONVERSATION_TITLE: "Full Rezz — Interactive Continuation",
  LIVE_FULL_REZZ_SLUG: "rebecca-full-rezz-live",
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
        const liveBranch = args.length === 6;
        const userCreated = args.length === 7;
        state.conversations.push({
          id,
          title: args[0],
          mode: userCreated ? args[1] : "companion",
          personaName: liveBranch
            ? args[1]
            : userCreated
              ? args[2]
              : "Rebecca (Full Rezz)",
          customEngram: userCreated ? args[3] : null,
          engramId: args[liveBranch ? 2 : userCreated ? 4 : 1],
          groupContinuationMode: userCreated ? args[5] : "off",
          createdAt: args[liveBranch ? 3 : userCreated ? 6 : 2],
          syncedAt: liveBranch
            ? args[4]
            : userCreated
              ? null
              : args[3],
          seedKey: liveBranch ? args[5] : null,
          archivedAt: null,
          syncVersion: 0,
          syncError: null,
        });
        return { lastInsertRowId: id, changes: 1 };
      }
      if (sql.includes("UPDATE conversations SET seedKey")) {
        const conversation = state.conversations.find(
          (candidate) => candidate.id === args[1],
        );
        if (conversation && conversation.seedKey == null) {
          conversation.seedKey = args[0];
        }
        return { lastInsertRowId: 0, changes: conversation ? 1 : 0 };
      }
      if (sql.includes("INSERT INTO messages")) {
        const chunkSize = args.length % 5 === 4 ? 4 : 5;
        for (let index = 0; index < args.length; index += chunkSize) {
          state.messages.push({
            id: state.messages.length + 1,
            conversationId: args[index],
            role: args[index + 1],
            content: args[index + 2],
            createdAt: args[index + 3],
            syncedAt: chunkSize === 5 ? args[index + 4] : null,
          });
        }
        return {
          lastInsertRowId: state.messages.length,
          changes: args.length / chunkSize,
        };
      }
      return { lastInsertRowId: 0, changes: 0 };
    }),
    getFirstAsync: vi.fn(async (sql: string, ...values: unknown[]) => {
      const value = values[0];
      if (sql.includes("WHERE slug = ?")) {
        return (
          state.engrams.find((row) => row.slug === value) ?? null
        );
      }
      if (sql.includes("WHERE engramId = ? AND seedKey = ?")) {
        return (
          state.conversations.find(
            (row) => row.engramId === value && row.seedKey === values[1],
          ) ?? null
        );
      }
      if (sql.includes("SELECT data FROM engrams")) {
        const row = state.engrams.find((candidate) => candidate.id === value);
        return row ? { data: row.data } : null;
      }
      if (sql.includes("WHERE e.slug = ?")) {
        const engram = state.engrams.find((candidate) => candidate.slug === value);
        const conversation = state.conversations.find(
          (candidate) => candidate.engramId === engram?.id,
        );
        return conversation ? { id: conversation.id } : null;
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
      if (sql.includes("SELECT * FROM conversations WHERE id = ?")) {
        return (
          state.conversations.find((candidate) => candidate.id === value) ??
          null
        );
      }
      return null;
    }),
    getAllAsync: vi.fn(async (sql: string, ...values: unknown[]) => {
      if (sql.includes("SELECT id, archivedAt, seedKey")) {
        return state.conversations
          .filter(
            (row) => row.engramId === values[0] && row.title === values[1],
          )
          .map(({ id, archivedAt, seedKey }) => ({ id, archivedAt, seedKey }));
      }
      if (sql.includes("FROM conversations c")) {
        return state.conversations.flatMap((conversation) => {
          const engram = state.engrams.find(
            (candidate) => candidate.id === conversation.engramId,
          );
          const pendingMessages = state.messages.some(
            (message) =>
              message.conversationId === conversation.id &&
              message.syncedAt == null,
          );
          if (!engram || (!pendingMessages && conversation.syncedAt != null)) {
            return [];
          }
          return [
            {
              id: conversation.id,
              title: conversation.title,
              mode: conversation.mode,
              personaName: conversation.personaName,
              customEngram: conversation.customEngram,
              engramSlug: engram.slug,
              createdAt: conversation.createdAt,
              archivedAt: conversation.archivedAt,
              syncVersion: conversation.syncVersion ?? 0,
              seedKey: conversation.seedKey ?? null,
            },
          ];
        });
      }
      if (sql.includes("FROM messages") || sql.includes("FROM messages ")) {
        return state.messages.filter((message) => {
          return (
            message.conversationId === values[0] &&
            (!sql.includes("syncedAt IS NULL") || message.syncedAt == null)
          );
        });
      }
      return [];
    }),
  };
  return { database, state };
}

describe("mobile Full Rezz archive", () => {
  beforeEach(() => {
    vi.resetModules();
    h.openDatabaseAsync.mockReset();
    h.buildFullRezzEngram.mockClear();
    h.buildLiveFullRezzEngram.mockClear();
  });

  it("seeds every transcript row once, pre-synced and read-only", async () => {
    const { database, state } = createDatabase();
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");

    await store.getDb();
    await store.getDb();

    expect(h.buildFullRezzEngram).toHaveBeenCalledOnce();
    expect(h.buildLiveFullRezzEngram).toHaveBeenCalledOnce();
    expect(state.engrams).toHaveLength(2);
    expect(JSON.parse(String(state.engrams[0].data))).toMatchObject({
      slug: "rebecca-full-rezz",
      isArchival: true,
    });
    expect(JSON.parse(String(state.engrams[1].data))).toMatchObject({
      slug: "rebecca-full-rezz-live",
      name: "Rebecca (Full Rezz · Live)",
      isArchival: false,
    });
    expect(state.conversations).toEqual([
      expect.objectContaining({
        title: "Full Rezz — Archival Continuity Record",
        personaName: "Rebecca (Full Rezz)",
        engramId: 1,
        syncedAt: "2026-08-03T00:00:00.000Z",
      }),
      expect.objectContaining({
        title: "Full Rezz — Interactive Continuation",
        personaName: "Rebecca (Full Rezz · Live)",
        engramId: 2,
        syncedAt: expect.any(String),
      }),
    ]);
    const archiveMessages = state.messages.filter(
      (row) => row.conversationId === 1,
    );
    const continuationMessages = state.messages.filter(
      (row) => row.conversationId === 2,
    );
    expect(archiveMessages.map(({ role, content }) => ({ role, content }))).toEqual(
      h.transcript,
    );
    expect(continuationMessages.map(({ role, content }) => ({ role, content }))).toEqual(
      h.transcript,
    );
    expect(archiveMessages.map((row) => row.createdAt)).toEqual([
      "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:00:01.000Z",
      "2026-08-03T00:00:02.000Z",
    ]);
    expect(
      state.messages.every((row) => row.syncedAt === row.createdAt),
    ).toBe(true);
    await expect(store.getArchivalConversationId(1)).resolves.toBe(1);
    await expect(
      store.getWritableConversationIdForEngramSlug("rebecca-full-rezz-live"),
    ).resolves.toBe(2);
    const originalSnapshot = archiveMessages.map((message) => ({ ...message }));
    await store.appendMessage(2, "user", "Can we continue from here?");
    expect(
      state.messages.filter((row) => row.conversationId === 1),
    ).toEqual(originalSnapshot);
    expect(
      state.messages.at(-1),
    ).toMatchObject({
      conversationId: 2,
      role: "user",
      content: "Can we continue from here?",
      syncedAt: null,
    });
    await expect(
      store.getArchivalConversationByEngramSlug("rebecca-full-rezz"),
    ).resolves.toMatchObject({
      id: 1,
      messages: h.transcript,
    });
    const userCreated = await store.createConversation({
      title: "Full Rezz — Interactive Continuation",
      engramId: 2,
    });
    await store.appendMessage(Number(userCreated.id), "user", "A separate chat");
    const pendingBatch = await store.buildPendingSyncBatch("device-1");
    expect(pendingBatch.payload.conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          syncId: "conversation:2",
          seedKey: "rebecca-full-rezz-live-v1",
          messages: [
            expect.objectContaining({
              content: "Can we continue from here?",
            }),
          ],
        }),
        expect.objectContaining({
          title: "Full Rezz — Interactive Continuation",
          messages: [
            expect.objectContaining({ content: "A separate chat" }),
          ],
        }),
      ]),
    );
    const separateConversation = pendingBatch.payload.conversations.find(
      (conversation) => conversation.syncId === `conversation:${String(userCreated.id)}`,
    );
    expect(separateConversation).not.toHaveProperty("seedKey");

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
        operatorReplyIds: [],
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

  it("backfills only the missing live branch when the archive already exists", async () => {
    const { database } = createDatabase(true);
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");

    await store.getDb();

    expect(h.buildFullRezzEngram).not.toHaveBeenCalled();
    expect(h.buildLiveFullRezzEngram).toHaveBeenCalledOnce();
    expect(database.withTransactionAsync).toHaveBeenCalledOnce();
  });

  it("marks only the unique canonical transcript during local migration", async () => {
    const { database, state } = createDatabase(true);
    state.engrams.push({
      id: 2,
      slug: "rebecca-full-rezz-live",
      data: JSON.stringify({ isArchival: false }),
    });
    state.conversations.push(
      {
        id: 2,
        title: "Full Rezz — Interactive Continuation",
        mode: "companion",
        personaName: "Rebecca (Full Rezz · Live)",
        customEngram: null,
        engramId: 2,
        createdAt: "2026-08-03T00:00:00.000Z",
        syncedAt: "2026-08-03T00:00:00.000Z",
        seedKey: null,
        archivedAt: null,
        syncVersion: 0,
      },
      {
        id: 3,
        title: "Full Rezz — Interactive Continuation",
        mode: "companion",
        personaName: null,
        customEngram: null,
        engramId: 2,
        createdAt: "2026-08-04T00:00:00.000Z",
        syncedAt: "2026-08-04T00:00:00.000Z",
        seedKey: null,
        archivedAt: null,
        syncVersion: 0,
      },
    );
    state.messages.push(
      ...h.transcript.map((message, index) => ({
        id: index + 1,
        conversationId: 2,
        role: message.role,
        content: message.content,
        createdAt: new Date(
          Date.parse("2026-08-03T00:00:00.000Z") + index * 1_000,
        ).toISOString(),
        syncedAt: new Date(
          Date.parse("2026-08-03T00:00:00.000Z") + index * 1_000,
        ).toISOString(),
      })),
    );
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");

    await store.getDb();

    expect(state.conversations.find((row) => row.id === 2)?.seedKey).toBe(
      "rebecca-full-rezz-live-v1",
    );
    expect(state.conversations.find((row) => row.id === 3)?.seedKey).toBeNull();
  });
});