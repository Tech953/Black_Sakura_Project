import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  setBaseUrl: vi.fn(),
  syncOfflineHistory: vi.fn(),
  markEngramMessagesSeen: vi.fn(),
  resolveServerUrl: vi.fn(),
  buildPendingSyncBatch: vi.fn(),
  markSyncBatchComplete: vi.fn(),
  listPendingHumanSeenIds: vi.fn(),
  markHumanMessagesSeenSynced: vi.fn(),
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
  markEngramMessagesSeen: mocks.markEngramMessagesSeen,
}));
vi.mock("../server-url", () => ({
  resolveServerUrl: mocks.resolveServerUrl,
}));
vi.mock("./store", () => ({
  buildPendingSyncBatch: mocks.buildPendingSyncBatch,
  markSyncBatchComplete: mocks.markSyncBatchComplete,
  listPendingHumanSeenIds: mocks.listPendingHumanSeenIds,
  markHumanMessagesSeenSynced: mocks.markHumanMessagesSeenSynced,
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
const operatorReplySyncId = "operator-reply:phone-a-1";
const operatorReplyBatch = {
  payload: {
    ...emptyBatch.payload,
    operatorReplies: [
      {
        syncId: operatorReplySyncId,
        messageId: 41,
        content: "I am here.",
        createdAt: "2026-09-13T12:00:01.000Z",
      },
    ],
  },
  localRows: {
    ...emptyBatch.localRows,
    operatorReplyIds: [operatorReplySyncId],
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
    mocks.listPendingHumanSeenIds.mockResolvedValue([]);
    mocks.markEngramMessagesSeen.mockResolvedValue({ updated: 0 });
    mocks.syncBatchIds.mockImplementation((batch) =>
      batch === pendingBatch
        ? ["conversation:7", "message:9"]
        : batch === operatorReplyBatch
          ? [operatorReplySyncId]
          : [],
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

  it("retries the same operator-reply ID after a lost response and completes only after its receipt", async () => {
    mocks.buildPendingSyncBatch
      .mockResolvedValueOnce(operatorReplyBatch)
      .mockResolvedValueOnce(operatorReplyBatch)
      .mockResolvedValueOnce(emptyBatch);
    mocks.syncOfflineHistory
      .mockRejectedValueOnce(new Error("response lost after server commit"))
      .mockResolvedValueOnce({
        syncedIds: [operatorReplySyncId],
        imported: {
          conversations: 0,
          messages: 0,
          inquiries: 0,
          transmissions: 0,
          observedEntries: 0,
          operatorReplies: 0,
        },
      });

    await expect(syncOfflineData()).rejects.toThrow(
      "response lost after server commit",
    );
    expect(mocks.markSyncBatchComplete).not.toHaveBeenCalled();

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 1,
      batches: 1,
    });

    expect(mocks.syncOfflineHistory).toHaveBeenCalledTimes(2);
    expect(mocks.syncOfflineHistory).toHaveBeenNthCalledWith(
      1,
      operatorReplyBatch.payload,
    );
    expect(mocks.syncOfflineHistory).toHaveBeenNthCalledWith(
      2,
      operatorReplyBatch.payload,
    );
    expect(mocks.syncOfflineHistory.mock.calls[0]?.[0].operatorReplies).toEqual([
      expect.objectContaining({ syncId: operatorReplySyncId }),
    ]);
    expect(mocks.markSyncBatchComplete).toHaveBeenCalledOnce();
    expect(mocks.markSyncBatchComplete).toHaveBeenCalledWith(
      operatorReplyBatch,
    );
  });

  it("reconciles offline human-message reads even when no history rows are pending", async () => {
    mocks.buildPendingSyncBatch.mockResolvedValue(emptyBatch);
    mocks.listPendingHumanSeenIds
      .mockResolvedValueOnce([41, 42])
      .mockResolvedValueOnce([41, 42])
      .mockResolvedValueOnce([]);
    mocks.markEngramMessagesSeen.mockResolvedValueOnce({ updated: 2 });

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 2,
      batches: 1,
    });

    expect(mocks.markEngramMessagesSeen).toHaveBeenCalledWith({
      ids: [41, 42],
    });
    expect(mocks.markHumanMessagesSeenSynced).toHaveBeenCalledWith([41, 42]);
    expect(mocks.syncOfflineHistory).not.toHaveBeenCalled();
  });

  it("keeps offline read IDs queued when the server mark-seen request fails", async () => {
    mocks.buildPendingSyncBatch.mockResolvedValue(emptyBatch);
    mocks.listPendingHumanSeenIds
      .mockResolvedValueOnce([41])
      .mockResolvedValueOnce([41])
      .mockResolvedValueOnce([41])
      .mockResolvedValueOnce([41])
      .mockResolvedValueOnce([]);
    mocks.markEngramMessagesSeen
      .mockRejectedValueOnce(new Error("network lost"))
      .mockResolvedValueOnce({ updated: 1 });

    await expect(syncOfflineData()).rejects.toThrow("network lost");
    expect(mocks.markHumanMessagesSeenSynced).not.toHaveBeenCalled();

    await expect(syncOfflineData()).resolves.toEqual({
      syncedRows: 1,
      batches: 1,
    });
    expect(mocks.markHumanMessagesSeenSynced).toHaveBeenCalledWith([41]);
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
