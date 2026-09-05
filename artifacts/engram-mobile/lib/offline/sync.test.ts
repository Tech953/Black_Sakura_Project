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
  },
  localRows: {
    conversationIds: [7],
    messageIds: [9],
    inquiryIds: [],
    transmissions: [],
    observedEntryIds: [],
  },
};
const emptyBatch = {
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
    transmissions: [],
    observedEntryIds: [],
  },
};

let syncOfflineData: typeof import("./sync").syncOfflineData;

describe("offline reconnect synchronization", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.storageGet.mockResolvedValue("device-1");
    mocks.resolveServerUrl.mockResolvedValue("https://engram.test");
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
    await vi.waitFor(() => expect(mocks.syncOfflineHistory).toHaveBeenCalledOnce());
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