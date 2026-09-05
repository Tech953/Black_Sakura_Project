import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setBaseUrl,
  syncOfflineHistory,
} from "@workspace/api-client-react";

import { resolveServerUrl } from "../server-url";
import {
  buildPendingSyncBatch,
  markSyncBatchComplete,
  syncBatchIds,
} from "./store";

const DEVICE_ID_KEY = "engram.offlineSyncDeviceId";
const MAX_BATCHES_PER_SYNC = 20;

export type OfflineSyncResult = {
  syncedRows: number;
  batches: number;
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

async function drainPendingRows(): Promise<OfflineSyncResult> {
  const deviceId = await getDeviceId();
  let batch = await buildPendingSyncBatch(deviceId);
  if (syncBatchIds(batch).length === 0) {
    return { syncedRows: 0, batches: 0 };
  }
  const serverUrl = await resolveServerUrl();
  await assertServerReachable(serverUrl);
  setBaseUrl(serverUrl);
  let syncedRows = 0;
  let batches = 0;

  while (batches < MAX_BATCHES_PER_SYNC) {
    const expectedIds = syncBatchIds(batch);
    if (expectedIds.length === 0) return { syncedRows, batches };

    const result = await syncOfflineHistory(batch.payload);
    const acknowledged = new Set(result.syncedIds);
    if (expectedIds.some((id) => !acknowledged.has(id))) {
      throw new Error("Server did not acknowledge every offline row");
    }
    await markSyncBatchComplete(batch);
    syncedRows += expectedIds.length;
    batches += 1;
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