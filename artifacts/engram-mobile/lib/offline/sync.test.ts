import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  setBaseUrl: vi.fn(),
  syncOfflineHistory: vi.fn(),
  resolveServerUrl: vi.fn(),
  buildPendingSyncBatch: vi.fn(),
  markSyncBatchComplete: vi.fn(),
  syncBatchIds: vi.fn(),
  getOfflineStoreAccountId: vi.fn(),
  markConversationSyncBlocked: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: mocks.storageGet,
    setItem: mocks.storageSet,
  },
}));
vi.mock("@workspace/api-client-react", () => ({
  setBaseUrl: mocks.setBaseUrl,
  syncOfflineHistory: mocks.syncOfflineHistory,
}));
vi.mock("../server-url", () => ({
  resolveServerUrl: mocks.resolveServerUrl,
}));
vi.mock("./store", () => ({
  buildPendingSyncBatch: mocks.buildPendingSyncBatch,
  markSyncBatchComplete: mocks.markSyncBatchComplete,
  syncBatchIds: mocks.syncBatchIds,
  getOfflineStoreAccountId: mocks.getOfflineStoreAccountId,
  markConversationSyncBlocked: mocks.markConversationSyncBlocked,
}));

const pendingBatch = {
  payload: {
    deviceId: "ignored-until-built",
    conversations: [
      {
        syncId: "conversation:7",
        title: "Offline",
        mode: "companion",
        engramSlug: "pyri",
        personaName: "Night Analyst",
        customEngram: "Be concise and evidence-led.",
        createdAt: "2026-09-04T12:00:00.000Z",
        messages: [
          {
            syncId: "message:9",
            role: "user" as const,
            content: "Hello",
            createdAt: "2026-09-04T12:00:01.000Z",
          },
        ],
      },
    ],
    inquiries: [],
    transmissions: [],
    observedEntries: [],
    operatorReplies: [],
  },
  localRows: {
    conversationIds: [7],
    messageIds: [9],
    inquiryIds: [],
    transmissions: [],
    observedEntryIds: [],
    operatorReplyIds: [],
  },
};
const emptyBatch = {
  payload: {
    deviceId: "device-1",
    conversations: [],
    inquiries: [],
    transmissions: [],
    observedEntries: [],
    operatorReplies: [],
  },
  localRows: {
    conversationIds: [],
    messageIds: [],
    inquiryIds: [],
    transmissions: [],
    observedEntryIds: [],
    operatorReplyIds: [],
  },
};

let syncOfflineData: typeof import("./sync").syncOfflineData;

describe("offline reconnect synchronization", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.storageGet.mockResolvedValue("device-1");
    mocks.resolveServerUrl.mockResolvedValue("https://engram.test");
    mocks.getOfflineStoreAccountId.mockReturnValue("account-a");
    mocks.syncBatchIds.mockImplementation((batch) =>
      batch === pendingBatch ? ["conversation:7", "message:9"] : [],
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200 })),
    );
    ({ syncOfflineData } = await import("./sync"));
  });

  it("keeps rows pending after failure and uploads the same stable IDs on retry", async () => {
    mocks.buildPendingSyncBatch.mockResolvedValueOnce(pendingBatch);
    mocks.syncOfflineHistory.mockRejectedValueOnce(new Error("network lost"));

    await expect(syncOfflineData()).rejects.toThrow("network lost");
    expect(mocks.markSyncBatchComplete).not.toHaveBeenCalled();

    mocks.buildPendingSyncBatch
      .mockResolvedValueOnce(pendingBatch)
      .mockResolvedValueOnce(emptyBatch);
    mocks.syncOfflineHistory.mockResolvedValueOnce({
      syncedIds: ["conversation:7", "message:9"],
      imported: {
        conversations: 0,
        messages: 0,
        inquiries: 0,
        transmissions: 0,
        observedEntries: 0,
      },
    });

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 2,
      batches: 1,
    });
    expect(mocks.syncOfflineHistory).toHaveBeenNthCalledWith(
      2,
      pendingBatch.payload,
    );
    expect(mocks.markSyncBatchComplete).toHaveBeenCalledOnce();
  });

  it("does not clear local markers after a partial acknowledgement", async () => {
    mocks.buildPendingSyncBatch.mockResolvedValueOnce(pendingBatch);
    mocks.syncOfflineHistory.mockResolvedValueOnce({
      syncedIds: ["conversation:7"],
      imported: {
        conversations: 1,
        messages: 1,
        inquiries: 0,
        transmissions: 0,
        observedEntries: 0,
      },
    });

    await expect(syncOfflineData()).rejects.toThrow(
      "Server did not acknowledge every offline row",
    );
    expect(mocks.markSyncBatchComplete).not.toHaveBeenCalled();
  });

  it("blocks an oversized custom persona instead of retrying it forever", async () => {
    const oversizedBatch = {
      ...pendingBatch,
      payload: {
        ...pendingBatch.payload,
        conversations: [
          {
            ...pendingBatch.payload.conversations[0],
            customEngram: "x".repeat(40_001),
          },
        ],
      },
    };
    mocks.buildPendingSyncBatch.mockResolvedValueOnce(oversizedBatch);
    mocks.syncBatchIds.mockReturnValue(["conversation:7", "message:9"]);

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 0,
      batches: 0,
      blockedRows: 1,
      blockedMessage:
        "This offline conversation cannot sync because its custom persona context is over the 40,000-character limit. Shorten it, then retry.",
    });
    expect(mocks.markConversationSyncBlocked).toHaveBeenCalledWith(
      7,
      "This offline conversation cannot sync because its custom persona context is over the 40,000-character limit. Shorten it, then retry.",
    );
    expect(mocks.syncOfflineHistory).not.toHaveBeenCalled();
    expect(mocks.markSyncBatchComplete).not.toHaveBeenCalled();
  });

  it("continues syncing legacy conversations without persona fields", async () => {
    const {
      personaName: _personaName,
      customEngram: _customEngram,
      ...legacyConversation
    } = pendingBatch.payload.conversations[0];
    const legacyBatch = {
      ...pendingBatch,
      payload: {
        ...pendingBatch.payload,
        conversations: [legacyConversation],
      },
    };
    mocks.buildPendingSyncBatch
      .mockResolvedValueOnce(legacyBatch)
      .mockResolvedValueOnce(emptyBatch);
    mocks.syncBatchIds.mockImplementation((batch) =>
      batch === legacyBatch ? ["conversation:7", "message:9"] : [],
    );
    mocks.syncOfflineHistory.mockResolvedValueOnce({
      syncedIds: ["conversation:7", "message:9"],
      imported: {
        conversations: 1,
        messages: 1,
        inquiries: 0,
        transmissions: 0,
        observedEntries: 0,
      },
    });

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 2,
      batches: 1,
    });
    expect(mocks.markConversationSyncBlocked).not.toHaveBeenCalled();
    expect(mocks.markSyncBatchComplete).toHaveBeenCalledOnce();
  });

  it("shares one in-flight upload across duplicate reconnect toggles", async () => {
    let finishUpload!: () => void;
    mocks.buildPendingSyncBatch
      .mockResolvedValueOnce(pendingBatch)
      .mockResolvedValueOnce(emptyBatch);
    mocks.syncOfflineHistory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishUpload = () =>
            resolve({
              syncedIds: ["conversation:7", "message:9"],
              imported: {
                conversations: 1,
                messages: 1,
                inquiries: 0,
                transmissions: 0,
                observedEntries: 0,
              },
            });
        }),
    );

    const first = syncOfflineData();
    const second = syncOfflineData();
    await vi.waitFor(() =>
      expect(mocks.syncOfflineHistory).toHaveBeenCalledOnce(),
    );
    finishUpload();

    await expect(Promise.all([first, second])).resolves.toEqual([
      { syncedRows: 2, batches: 1 },
      { syncedRows: 2, batches: 1 },
    ]);
    expect(mocks.syncOfflineHistory).toHaveBeenCalledOnce();
    expect(mocks.markSyncBatchComplete).toHaveBeenCalledOnce();
  });

  it("does not probe the network when no offline rows are pending", async () => {
    mocks.buildPendingSyncBatch.mockResolvedValueOnce(emptyBatch);

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 0,
      batches: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.syncOfflineHistory).not.toHaveBeenCalled();
  });
});
