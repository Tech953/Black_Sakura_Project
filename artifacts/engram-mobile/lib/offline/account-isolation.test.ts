import { beforeEach, describe, expect, it, vi } from "vitest";

type ConversationRow = {
  id: number;
  title: string;
  mode: string;
  personaName: null;
  customEngram: null;
  engramId: null;
  engramSlug: null;
  createdAt: string;
  archivedAt: null;
  syncVersion: number;
  syncedAt: string | null;
};

type MessageRow = {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  syncedAt: string | null;
};

type FakeDatabase = {
  name: string;
  conversations: ConversationRow[];
  messages: MessageRow[];
  closeAsync: ReturnType<typeof vi.fn>;
  execAsync: ReturnType<typeof vi.fn>;
  runAsync: ReturnType<typeof vi.fn>;
  getFirstAsync: ReturnType<typeof vi.fn>;
  getAllAsync: ReturnType<typeof vi.fn>;
  withTransactionAsync: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
  databases: new Map<string, FakeDatabase>(),
  openDatabaseAsync: vi.fn(),
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  resolveServerUrl: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: mocks.openDatabaseAsync,
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: mocks.storageGet,
    setItem: mocks.storageSet,
  },
}));

vi.mock("@workspace/db/seed/engram-data", () => ({
  engramSeedData: [],
}));

vi.mock("@workspace/db/seed/rebecca-adaptive-data", () => ({
  buildRebeccaAdaptiveMemorySource: vi.fn(),
  enrichRebeccaAdaptiveProfile: vi.fn((value) => value),
  REBECCA_ADAPTIVE_MEMORY_NODES: [],
}));

vi.mock("@workspace/engram-core", () => ({
  TRUSTED_REBECCA_ADAPTIVE_SOURCES: [],
}));

vi.mock("../server-url", () => ({
  resolveServerUrl: mocks.resolveServerUrl,
}));

function createDatabase(name: string): FakeDatabase {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  let nextConversationId = 1;
  let nextMessageId = 1;

  const database = {
    name,
    conversations,
    messages,
    closeAsync: vi.fn(async () => {}),
    execAsync: vi.fn(async () => {}),
    runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("INSERT INTO conversations")) {
        const [title, mode, personaName, customEngram, engramId, , createdAt] =
          args;
        const row: ConversationRow = {
          id: nextConversationId++,
          title: String(title ?? "New conversation"),
          mode: String(mode ?? "companion"),
          personaName: (personaName as null) ?? null,
          customEngram: (customEngram as null) ?? null,
          engramId: (engramId as null) ?? null,
          engramSlug: null,
          createdAt: String(createdAt),
          archivedAt: null,
          syncVersion: 0,
          syncedAt: null,
        };
        conversations.push(row);
        return { lastInsertRowId: row.id, changes: 1 };
      }

      if (sql.includes("INSERT INTO messages")) {
        const [conversationId, role, content, createdAt] = args;
        const row: MessageRow = {
          id: nextMessageId++,
          conversationId: Number(conversationId),
          role: role as MessageRow["role"],
          content: String(content),
          createdAt: String(createdAt),
          syncedAt: null,
        };
        messages.push(row);
        return { lastInsertRowId: row.id, changes: 1 };
      }

      if (sql.includes("UPDATE conversations") && sql.includes("syncedAt")) {
        const [, id, syncVersion] = args;
        const row = conversations.find(
          (candidate) =>
            candidate.id === Number(id) &&
            candidate.syncVersion === Number(syncVersion),
        );
        if (row) row.syncedAt = String(args[0]);
        return { lastInsertRowId: 0, changes: row ? 1 : 0 };
      }

      if (sql.includes("UPDATE messages") && sql.includes("syncedAt")) {
        const completedAt = String(args[0]);
        const ids = args.slice(1).map(Number);
        let changes = 0;
        for (const row of messages) {
          if (ids.includes(row.id) && row.syncedAt === null) {
            row.syncedAt = completedAt;
            changes += 1;
          }
        }
        return { lastInsertRowId: 0, changes };
      }

      return { lastInsertRowId: 0, changes: 0 };
    }),
    getFirstAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("slug = ?")) {
        // Skip the large archival seed during this focused account test.
        return { id: 1 };
      }
      if (sql.includes("SELECT syncedAt FROM conversations")) {
        return (
          conversations.find((candidate) => candidate.id === Number(args[0])) ??
          null
        );
      }
      if (sql.includes("FROM conversations")) {
        return (
          conversations.find((candidate) => candidate.id === Number(args[0])) ??
          null
        );
      }
      return null;
    }),
    getAllAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes("FROM conversations c")) {
        return conversations.filter(
          (conversation) =>
            conversation.syncedAt === null ||
            messages.some(
              (message) =>
                message.conversationId === conversation.id &&
                message.syncedAt === null,
            ),
        );
      }
      if (sql.includes("FROM messages")) {
        return messages.filter(
          (message) =>
            message.conversationId === Number(args[0]) &&
            message.syncedAt === null,
        );
      }
      return [];
    }),
    withTransactionAsync: vi.fn(async (callback: () => Promise<void>) =>
      callback(),
    ),
  } satisfies FakeDatabase;

  return database;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mobile offline account boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.databases.clear();
    mocks.openDatabaseAsync.mockReset();
    mocks.storageGet.mockReset();
    mocks.storageSet.mockReset();
    mocks.resolveServerUrl.mockReset();
    mocks.storageGet.mockResolvedValue("shared-device");
    mocks.resolveServerUrl.mockResolvedValue("http://offline-test");
    mocks.openDatabaseAsync.mockImplementation(async (name: string) => {
      const existing = mocks.databases.get(name);
      if (existing) return existing;
      const created = createDatabase(name);
      mocks.databases.set(name, created);
      return created;
    });
  });

  it("keeps switched accounts isolated while bearer-auth retries reuse device IDs", async () => {
    const requests: Array<{
      token: string | null;
      body: {
        deviceId: string;
        conversations: Array<{
          syncId: string;
          messages: Array<{ syncId: string; content: string }>;
        }>;
      };
    }> = [];
    let failNextUpload = false;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/api/healthz")) return jsonResponse({ status: "ok" });

        const headers = new Headers(init?.headers);
        const body = JSON.parse(
          String(init?.body),
        ) as (typeof requests)[number]["body"];
        requests.push({
          token: headers.get("authorization"),
          body,
        });
        if (failNextUpload) {
          failNextUpload = false;
          throw new Error("network lost during account B upload");
        }

        const syncedIds = body.conversations.flatMap((conversation) => [
          conversation.syncId,
          ...conversation.messages.map((message) => message.syncId),
        ]);
        return jsonResponse({
          syncedIds,
          imported: {
            conversations: body.conversations.length,
            messages: body.conversations.reduce(
              (total, conversation) => total + conversation.messages.length,
              0,
            ),
            inquiries: 0,
            transmissions: 0,
            observedEntries: 0,
          },
        });
      }),
    );

    const {
      appendMessage,
      createConversation,
      listConversations,
      setOfflineStoreAccount,
    } = await import("./store");
    const { syncOfflineData } = await import("./sync");
    const { setAuthTokenGetter } = await import("@workspace/api-client-react");

    await setOfflineStoreAccount("account-a");
    const accountAConversation = await createConversation({
      title: "Account A private history",
    });
    await appendMessage(accountAConversation.id as number, "user", "only A");

    // Switching accounts must replace the active local database before the
    // second account can render or synchronize anything.
    await setOfflineStoreAccount("account-b");
    expect(await listConversations()).toEqual([]);

    const accountBConversation = await createConversation({
      title: "Account B private history",
    });
    await appendMessage(accountBConversation.id as number, "user", "only B");

    setAuthTokenGetter(() => "clerk-token-account-b");
    failNextUpload = true;
    await expect(syncOfflineData()).rejects.toThrow("network lost");
    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 2,
      batches: 1,
    });

    await setOfflineStoreAccount("account-a");
    expect(await listConversations()).toHaveLength(1);
    setAuthTokenGetter(() => "clerk-token-account-a");
    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 2,
      batches: 1,
    });

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      token: "Bearer clerk-token-account-b",
      body: {
        deviceId: "shared-device",
        conversations: [
          {
            syncId: "conversation:1",
            messages: [{ syncId: "message:1", content: "only B" }],
          },
        ],
      },
    });
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[2]).toMatchObject({
      token: "Bearer clerk-token-account-a",
      body: {
        deviceId: "shared-device",
        conversations: [
          {
            syncId: "conversation:1",
            messages: [{ syncId: "message:1", content: "only A" }],
          },
        ],
      },
    });

    const accountADatabase = mocks.databases.get("engram-offline-account-a.db");
    const accountBDatabase = mocks.databases.get("engram-offline-account-b.db");
    expect(
      accountADatabase?.messages.map((message) => message.content),
    ).toEqual(["only A"]);
    expect(
      accountBDatabase?.messages.map((message) => message.content),
    ).toEqual(["only B"]);
    expect(accountADatabase?.closeAsync).toHaveBeenCalled();
    setAuthTokenGetter(null);
  });
});
