import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

/**
 * On-device model manager: downloads, verifies, and stores the GGUF chat model
 * used by offline mode. The model is fetched once (~1.1 GB) and kept in the
 * app's document directory; after that, offline mode needs no network at all.
 */
export const MODEL_NAME = "Qwen3 1.7B (4-bit)";
export const MODEL_URL =
  "https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf";
/** Exact size of the artifact above; used to verify a completed download. */
export const MODEL_BYTES = 1107409472;

const MODEL_DIR = `${FileSystem.documentDirectory}models`;
export const MODEL_PATH = `${MODEL_DIR}/qwen3-1.7b-q4_k_m.gguf`;
const PARTIAL_PATH = `${MODEL_PATH}.part`;

export type ModelStatus =
  | { state: "ready"; bytes: number }
  | { state: "missing" }
  | { state: "partial"; bytes: number };

export async function getModelStatus(): Promise<ModelStatus> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_PATH);
    if (info.exists) {
      const bytes = (info as { size?: number }).size ?? 0;
      if (bytes === MODEL_BYTES) return { state: "ready", bytes };
      // Wrong size = corrupt/interrupted rename; treat as missing.
      await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
    }
    const part = await FileSystem.getInfoAsync(PARTIAL_PATH);
    if (part.exists) {
      return { state: "partial", bytes: (part as { size?: number }).size ?? 0 };
    }
  } catch {
    // fall through
  }
  return { state: "missing" };
}

let activeDownload: FileSystem.DownloadResumable | null = null;
let downloadPromise: Promise<void> | null = null;

/** Key holding expo's serialized resume state, so a paused/interrupted download survives app relaunch. */
const RESUME_KEY = "engram.modelDownload.resumeData";

/**
 * Download the model with progress callbacks. Genuinely resumes a paused or
 * interrupted download when expo resume state was persisted (otherwise the
 * partial file is discarded and the download restarts). Throws on failure; on
 * success the verified model is at MODEL_PATH.
 */
export function downloadModel(
  onProgress: (writtenBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (downloadPromise) return downloadPromise;
  downloadPromise = performDownload(onProgress).finally(() => {
    downloadPromise = null;
  });
  return downloadPromise;
}

async function performDownload(
  onProgress: (writtenBytes: number, totalBytes: number) => void,
): Promise<void> {
  await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });

  const free = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
  if (free != null && free < MODEL_BYTES * 1.1) {
    throw new Error(
      `Not enough storage: the model needs ~${Math.ceil(MODEL_BYTES / 1e9)} GB free.`,
    );
  }

  const progressCb = (p: FileSystem.DownloadProgressData) =>
    onProgress(p.totalBytesWritten, p.totalBytesExpectedToWrite || MODEL_BYTES);

  const resumeData = await AsyncStorage.getItem(RESUME_KEY).catch(() => null);
  let resuming = false;
  if (resumeData) {
    const part = await FileSystem.getInfoAsync(PARTIAL_PATH);
    if (part.exists) {
      activeDownload = new FileSystem.DownloadResumable(
        MODEL_URL,
        PARTIAL_PATH,
        {},
        progressCb,
        resumeData,
      );
      resuming = true;
    } else {
      await AsyncStorage.removeItem(RESUME_KEY).catch(() => {});
    }
  }
  if (!activeDownload) {
    // No valid resume state: a stray partial file cannot be trusted — restart.
    await FileSystem.deleteAsync(PARTIAL_PATH, { idempotent: true });
    activeDownload = FileSystem.createDownloadResumable(
      MODEL_URL,
      PARTIAL_PATH,
      {},
      progressCb,
    );
  }
  try {
    const result = resuming
      ? await activeDownload.resumeAsync()
      : await activeDownload.downloadAsync();
    // 200 = fresh download, 206 = resumed range request.
    if (!result || (result.status !== 200 && result.status !== 206)) {
      throw new Error(`Model download failed (HTTP ${result?.status ?? "?"})`);
    }
    const info = await FileSystem.getInfoAsync(PARTIAL_PATH);
    const bytes = info.exists ? ((info as { size?: number }).size ?? 0) : 0;
    if (bytes !== MODEL_BYTES) {
      await FileSystem.deleteAsync(PARTIAL_PATH, { idempotent: true });
      await AsyncStorage.removeItem(RESUME_KEY).catch(() => {});
      throw new Error("Model download was incomplete — please retry.");
    }
    await FileSystem.moveAsync({ from: PARTIAL_PATH, to: MODEL_PATH });
    await AsyncStorage.removeItem(RESUME_KEY).catch(() => {});
  } finally {
    activeDownload = null;
  }
}

/** Pause an in-flight download, persisting resume state for a later resume. */
export async function cancelDownload(): Promise<void> {
  const dl = activeDownload;
  activeDownload = null;
  if (!dl) return;
  try {
    await dl.pauseAsync();
    const saved = dl.savable();
    if (saved.resumeData) {
      await AsyncStorage.setItem(RESUME_KEY, saved.resumeData);
    }
  } catch {
    // pause failed (already finished or errored) — resume state stays unset
  }
}

export async function deleteModel(): Promise<void> {
  const inFlight = downloadPromise;
  await cancelDownload();
  await inFlight?.catch(() => {});
  await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
  await FileSystem.deleteAsync(PARTIAL_PATH, { idempotent: true });
  await AsyncStorage.removeItem(RESUME_KEY).catch(() => {});
}
