import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import {
  activateKeepAwakeAsync,
  deactivateKeepAwake,
} from "expo-keep-awake";

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
export const CUSTOM_MODEL_PATH = `${MODEL_DIR}/custom-model.gguf`;
const CUSTOM_PARTIAL_PATH = `${CUSTOM_MODEL_PATH}.part`;
const CUSTOM_BACKUP_PATH = `${CUSTOM_MODEL_PATH}.previous`;
const CUSTOM_METADATA_KEY = "engram.customModel.metadata";
const GGUF_IMPORT_WAKE_TAG = "engram-gguf-import";
const MIN_GGUF_BYTES = 1024 * 1024;
export const MODEL_IMPORT_SAFETY_MULTIPLIER = 1.1;
const GGUF_MAGIC = "GGUF";
const MIN_GGUF_VERSION = 2;
const MAX_GGUF_VERSION = 4;

export type ModelSource = "bundled" | "custom";

export type CustomModelMetadata = {
  filename: string;
  byteSize: number;
  ggufVersion: number;
  importedAt: string;
};

export type ModelStatus =
  | {
      state: "ready";
      bytes: number;
      source: ModelSource;
      filename: string;
      bundledAvailable: boolean;
      customAvailable: boolean;
    }
  | {
      state: "missing";
      bundledAvailable: false;
      customAvailable: false;
    }
  | {
      state: "partial";
      bytes: number;
      source: ModelSource;
      bundledAvailable: boolean;
      customAvailable: boolean;
    };

export type ImportProgress = (fraction: number) => void;

export type CustomModelStorageCheck = {
  byteSize: number;
  requiredBytes: number;
  freeBytes: number | null;
  hasHeadroom: boolean | null;
};

export class ModelImportCancelledError extends Error {
  readonly code = "MODEL_IMPORT_CANCELLED";

  constructor() {
    super("GGUF import was cancelled.");
    this.name = "ModelImportCancelledError";
  }
}

type ImportControl = { cancelled: boolean };
let activeImport: ImportControl | null = null;

export function cancelCustomModelImport(): boolean {
  if (!activeImport) return false;
  activeImport.cancelled = true;
  return true;
}

function throwIfImportCancelled(control: ImportControl): void {
  if (control.cancelled) throw new ModelImportCancelledError();
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop()?.trim() || "custom-model.gguf";
  return basename.slice(0, 160);
}

async function readCustomMetadata(): Promise<CustomModelMetadata | null> {
  const raw = await AsyncStorage.getItem(CUSTOM_METADATA_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<CustomModelMetadata>;
    const version = value.ggufVersion;
    if (
      typeof value.filename !== "string" ||
      !value.filename.toLowerCase().endsWith(".gguf") ||
      typeof value.byteSize !== "number" ||
      value.byteSize < MIN_GGUF_BYTES ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < MIN_GGUF_VERSION ||
      version > MAX_GGUF_VERSION ||
      typeof value.importedAt !== "string"
    ) {
      return null;
    }
    return {
      filename: safeFilename(value.filename),
      byteSize: value.byteSize,
      ggufVersion: version,
      importedAt: value.importedAt,
    };
  } catch {
    return null;
  }
}

function decodeBase64(value: string): Uint8Array {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = value.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of clean) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) continue;
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

async function readGgufVersion(path: string): Promise<number> {
  const encoded = await FileSystem.readAsStringAsync(path, {
    encoding: FileSystem.EncodingType.Base64,
    position: 0,
    length: 8,
  });
  const bytes = decodeBase64(encoded);
  const magic = String.fromCharCode(...bytes.slice(0, 4));
  if (magic !== GGUF_MAGIC || bytes.length < 8) {
    throw new Error("That file is not a valid GGUF model.");
  }
  const version =
    bytes[4] |
    (bytes[5] << 8) |
    (bytes[6] << 16) |
    (bytes[7] << 24);
  if (version < MIN_GGUF_VERSION || version > MAX_GGUF_VERSION) {
    throw new Error(`Unsupported GGUF version ${version}.`);
  }
  return version;
}

async function modelInfo(path: string): Promise<{ exists: boolean; bytes: number }> {
  const info = await FileSystem.getInfoAsync(path);
  return {
    exists: info.exists,
    bytes: info.exists ? ((info as { size?: number }).size ?? 0) : 0,
  };
}

/**
 * Check the app-private storage headroom for a picked model without copying,
 * persisting, or uploading the provider URI.
 */
export async function getCustomModelStorageCheck(
  sourceUri: string,
  sourceBytes?: number,
): Promise<CustomModelStorageCheck> {
  const sourceInfo = await modelInfo(sourceUri);
  const byteSize = sourceBytes ?? sourceInfo.bytes;
  if (!sourceInfo.exists || byteSize < MIN_GGUF_BYTES) {
    throw new Error("The GGUF file is missing or too small to be a model.");
  }
  const freeBytes = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
  const requiredBytes = Math.ceil(byteSize * MODEL_IMPORT_SAFETY_MULTIPLIER);
  return {
    byteSize,
    requiredBytes,
    freeBytes,
    hasHeadroom: freeBytes === null ? null : freeBytes >= requiredBytes,
  };
}

export async function getModelStatus(): Promise<ModelStatus> {
  try {
    const [bundled, custom, customMetadata] = await Promise.all([
      modelInfo(MODEL_PATH),
      modelInfo(CUSTOM_MODEL_PATH),
      readCustomMetadata(),
    ]);
    const customReady =
      custom.exists &&
      customMetadata !== null &&
      custom.bytes === customMetadata.byteSize;
    if (!customReady && (custom.exists || customMetadata)) {
      await FileSystem.deleteAsync(CUSTOM_MODEL_PATH, { idempotent: true });
      await AsyncStorage.removeItem(CUSTOM_METADATA_KEY).catch(() => {});
    }
    const bundledReady = bundled.exists && bundled.bytes === MODEL_BYTES;
    if (bundled.exists && !bundledReady) {
      // Wrong size = corrupt/interrupted rename; treat as missing.
      await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
    }
    const part = await FileSystem.getInfoAsync(PARTIAL_PATH);
    const customPart = await FileSystem.getInfoAsync(CUSTOM_PARTIAL_PATH);

    if (customReady && customMetadata) {
      return {
        state: "ready",
        bytes: custom.bytes,
        source: "custom",
        filename: customMetadata.filename,
        bundledAvailable: bundledReady,
        customAvailable: true,
      };
    }
    if (bundledReady) {
      return {
        state: "ready",
        bytes: bundled.bytes,
        source: "bundled",
        filename: MODEL_NAME,
        bundledAvailable: true,
        customAvailable: false,
      };
    }
    if (customPart.exists) {
      return {
        state: "partial",
        bytes: (customPart as { size?: number }).size ?? 0,
        source: "custom",
        bundledAvailable: false,
        customAvailable: false,
      };
    }
    if (part.exists) {
      return {
        state: "partial",
        bytes: (part as { size?: number }).size ?? 0,
        source: "bundled",
        bundledAvailable: false,
        customAvailable: false,
      };
    }
  } catch {
    // fall through
  }
  return { state: "missing", bundledAvailable: false, customAvailable: false };
}

export async function getActiveModelPath(): Promise<string> {
  const status = await getModelStatus();
  if (status.state !== "ready") {
    throw new Error("The on-device model is not ready.");
  }
  return status.source === "custom" ? CUSTOM_MODEL_PATH : MODEL_PATH;
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

export async function importCustomModel(
  sourceUri: string,
  originalFilename: string,
  sourceBytes: number | undefined,
  onProgress?: ImportProgress,
  validate?: () => Promise<void>,
): Promise<CustomModelMetadata> {
  if (activeImport) {
    throw new Error("Another GGUF import is already in progress.");
  }
  const control: ImportControl = { cancelled: false };
  activeImport = control;
  const filename = safeFilename(originalFilename);
  try {
    // Keep the device awake only for the transactional import. Both calls are
    // best-effort so a platform wake-lock failure never prevents a safe import.
    await activateKeepAwakeAsync(GGUF_IMPORT_WAKE_TAG).catch(() => {});
    if (!filename.toLowerCase().endsWith(".gguf")) {
      throw new Error("Choose a file with the .gguf extension.");
    }

    await FileSystem.makeDirectoryAsync(MODEL_DIR, { intermediates: true });
    const storage = await getCustomModelStorageCheck(sourceUri, sourceBytes);
    const byteSize = storage.byteSize;
    if (storage.hasHeadroom === false) {
      throw new Error(
        `Not enough storage: the model needs ~${Math.ceil(storage.requiredBytes / 1e9)} GB free.`,
      );
    }

    await FileSystem.deleteAsync(CUSTOM_PARTIAL_PATH, { idempotent: true });
    throwIfImportCancelled(control);
    onProgress?.(0);
    try {
      await FileSystem.copyAsync({
        from: sourceUri,
        to: CUSTOM_PARTIAL_PATH,
      });
      throwIfImportCancelled(control);
      const staged = await modelInfo(CUSTOM_PARTIAL_PATH);
      if (!staged.exists || staged.bytes !== byteSize) {
        throw new Error("The imported GGUF copy was incomplete.");
      }
      const ggufVersion = await readGgufVersion(CUSTOM_PARTIAL_PATH);
      throwIfImportCancelled(control);
      onProgress?.(0.75);

      const previousMetadata = await AsyncStorage.getItem(CUSTOM_METADATA_KEY);
      const previous = await modelInfo(CUSTOM_MODEL_PATH);
      await FileSystem.deleteAsync(CUSTOM_BACKUP_PATH, { idempotent: true });
      throwIfImportCancelled(control);
      if (previous.exists) {
        await FileSystem.moveAsync({
          from: CUSTOM_MODEL_PATH,
          to: CUSTOM_BACKUP_PATH,
        });
      }

      const metadata: CustomModelMetadata = {
        filename,
        byteSize,
        ggufVersion,
        importedAt: new Date().toISOString(),
      };
      try {
        throwIfImportCancelled(control);
        await FileSystem.moveAsync({
          from: CUSTOM_PARTIAL_PATH,
          to: CUSTOM_MODEL_PATH,
        });
        await AsyncStorage.setItem(
          CUSTOM_METADATA_KEY,
          JSON.stringify(metadata),
        );
        if (validate) await validate();
        throwIfImportCancelled(control);
        await FileSystem.deleteAsync(CUSTOM_BACKUP_PATH, { idempotent: true });
        onProgress?.(1);
        return metadata;
      } catch (error) {
        await FileSystem.deleteAsync(CUSTOM_MODEL_PATH, { idempotent: true });
        if ((await modelInfo(CUSTOM_BACKUP_PATH)).exists) {
          await FileSystem.moveAsync({
            from: CUSTOM_BACKUP_PATH,
            to: CUSTOM_MODEL_PATH,
          });
        }
        if (previousMetadata) {
          await AsyncStorage.setItem(CUSTOM_METADATA_KEY, previousMetadata);
        } else {
          await AsyncStorage.removeItem(CUSTOM_METADATA_KEY).catch(() => {});
        }
        throw error;
      }
    } finally {
      await FileSystem.deleteAsync(CUSTOM_PARTIAL_PATH, { idempotent: true });
    }
  } finally {
    await deactivateKeepAwake(GGUF_IMPORT_WAKE_TAG).catch(() => {});
    if (activeImport === control) activeImport = null;
  }
}

export async function deleteCustomModel(): Promise<void> {
  await FileSystem.deleteAsync(CUSTOM_MODEL_PATH, { idempotent: true });
  await FileSystem.deleteAsync(CUSTOM_PARTIAL_PATH, { idempotent: true });
  await FileSystem.deleteAsync(CUSTOM_BACKUP_PATH, { idempotent: true });
  await AsyncStorage.removeItem(CUSTOM_METADATA_KEY).catch(() => {});
}

export async function deleteActiveModel(): Promise<void> {
  const status = await getModelStatus();
  if (status.state === "ready" && status.source === "custom") {
    await deleteCustomModel();
    return;
  }
  await deleteModel();
}

export async function deleteModel(): Promise<void> {
  const inFlight = downloadPromise;
  await cancelDownload();
  await inFlight?.catch(() => {});
  await FileSystem.deleteAsync(MODEL_PATH, { idempotent: true });
  await FileSystem.deleteAsync(PARTIAL_PATH, { idempotent: true });
  await AsyncStorage.removeItem(RESUME_KEY).catch(() => {});
}
