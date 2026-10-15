import AsyncStorage from "@react-native-async-storage/async-storage";
import { SyncOfflineHistoryBody } from "@workspace/api-zod";
import {
  markEngramMessagesSeen,
  setBaseUrl,
  syncOfflineHistory,
} from "@workspace/api-client-react";

import { resolveServerUrl } from "../server-url";
import {
  buildPendingSyncBatch,
  getOfflineStoreAccountId,
  listPendingHumanSeenIds,
  markConversationSyncBlocked,
  markHumanMessagesSeenSynced,
  markSyncBatchComplete,
  syncBatchIds,
} from "./store";

const DEVICE_ID_KEY = "engram.offlineSyncDeviceId";
const MAX_BATCHES_PER_SYNC = 20;
const HUMAN_SEEN_BATCH_SIZE = 100;

export type OfflineSyncResult = {
  syncedRows: number;
  batches: number;
  blockedRows?: number;
  blockedMessage?: string;
};

let activeSync: Promise<OfflineSyncResult> | null = null;

async function getDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const created = `mobile-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

async function assertServerReachable(serverUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${serverUrl}/api/healthz`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Server responded ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function drainPendingHumanSeen(
  assertSameAccount: () => void,
): Promise<{ syncedRows: number; batches: number }> {
  let syncedRows = 0;
  let batches = 0;

  while (batches < MAX_BATCHES_PER_SYNC) {
    const ids = await listPendingHumanSeenIds(HUMAN_SEEN_BATCH_SIZE);
    if (ids.length === 0) return { syncedRows, batches };

    assertSameAccount();
    await markEngramMessagesSeen({ ids });
    assertSameAccount();
    await markHumanMessagesSeenSynced(ids);
    syncedRows += ids.length;
    batches += 1;
  }

  if ((await listPendingHumanSeenIds(1)).length > 0) {
    throw new Error("Offline read state requires another sync pass");
  }
  return { syncedRows, batches };
}

async function drainPendingRows(): Promise<OfflineSyncResult> {
  const syncAccountId = getOfflineStoreAccountId();
  if (!syncAccountId) {
    throw new Error(
      "An authenticated account is required to synchronize offline history.",
    );
  }
  const assertSameAccount = () => {
    if (getOfflineStoreAccountId() !== syncAccountId) {
      throw new Error(
        "Offline account changed; synchronization was cancelled.",
      );
    }
  };
  const deviceId = await getDeviceId();
  let batch = await buildPendingSyncBatch(deviceId);
  const expectedIds = syncBatchIds(batch);
  const pendingSeenIds = await listPendingHumanSeenIds(HUMAN_SEEN_BATCH_SIZE);
  if (expectedIds.length === 0 && pendingSeenIds.length === 0) {
    return { syncedRows: 0, batches: 0 };
  }
  const validation = SyncOfflineHistoryBody.safeParse(batch.payload);
  let blockedResult:
    | Pick<OfflineSyncResult, "blockedRows" | "blockedMessage">
    | undefined;
  if (!validation.success) {
    const conversationIndex = validation.error.issues.find(
      (issue) => issue.path[0] === "conversations",
    )?.path[1];
    const conversation =
      typeof conversationIndex === "number"
        ? batch.payload.conversations[conversationIndex]
        : undefined;
    const localConversationId = Number(
      /^conversation:(\d+)$/.exec(conversation?.syncId ?? "")?.[1],
    );
    const field = validation.error.issues.find(
      (issue) =>
        issue.path[0] === "conversations" &&
        issue.path[1] === conversationIndex,
    )?.path[2];
    const message =
      field === "personaName"
        ? "This offline conversation cannot sync because its persona name is over the 200-character limit. Shorten it, then retry."
        : field === "customEngram"
          ? "This offline conversation cannot sync because its custom persona context is over the 40,000-character limit. Shorten it, then retry."
          : "This offline conversation cannot sync because it contains invalid data. Review it, then retry.";
    if (Number.isFinite(localConversationId)) {
      await markConversationSyncBlocked(localConversationId, message);
    }
    blockedResult = {
      blockedRows: 1,
      blockedMessage: message,
    };
    if (pendingSeenIds.length === 0) {
      return { syncedRows: 0, batches: 0, ...blockedResult };
    }
  }
  const serverUrl = await resolveServerUrl();
  await assertServerReachable(serverUrl);
  assertSameAccount();
  setBaseUrl(serverUrl);
  const seenSync = await drainPendingHumanSeen(assertSameAccount);
  let syncedRows = seenSync.syncedRows;
  let batches = seenSync.batches;
  if (blockedResult) return { syncedRows, batches, ...blockedResult };
  if (expectedIds.length === 0) return { syncedRows, batches };

  let historyBatches = 0;
  while (historyBatches < MAX_BATCHES_PER_SYNC) {
    const currentIds = syncBatchIds(batch);
    if (currentIds.length === 0) return { syncedRows, batches };

    // The bearer token is read by the API client at request time. Guard the
    // account immediately before that point so an in-flight sync can never
    // upload account A's batch with account B's newly installed Clerk token.
    assertSameAccount();
    const result = await syncOfflineHistory(batch.payload);
    assertSameAccount();
    const acknowledged = new Set(result.syncedIds);
    if (currentIds.some((id) => !acknowledged.has(id))) {
      throw new Error("Server did not acknowledge every offline row");
    }
    await markSyncBatchComplete(batch);
    syncedRows += currentIds.length;
    batches += 1;
    historyBatches += 1;
    batch = await buildPendingSyncBatch(deviceId);
  }

  throw new Error("Offline history requires another sync pass");
}

export function syncOfflineData(): Promise<OfflineSyncResult> {
  if (!activeSync) {
    activeSync = drainPendingRows().finally(() => {
      activeSync = null;
    });
  }
  return activeSync;
}
