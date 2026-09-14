import type { OfflineModelFailureKind } from "./offline-model";
import type { LocalModelFailure } from "./desktop-settings";

export type DesktopLlmMode = "bundled" | "custom" | "offline" | "online";

export interface CustomModelMetadataView {
  filename: string;
  displayName: string;
  byteSize: number;
  sha256: string;
  ggufVersion: number;
  importedAt: string;
  lastUsedAt: string;
}

export interface CustomModelView {
  storageLocation: string;
  status: "none" | "available" | "active" | "missing" | "corrupt" | "error";
  compatibility: "compatible" | "incompatible" | "unknown";
  error?: string;
  metadata?: CustomModelMetadataView;
}

export type OfflineModelStatus =
  | "none"
  | "downloading"
  | "partial"
  | "available"
  | "active"
  | "corrupt"
  | "error";

export interface OfflineModelView {
  filename: string;
  expectedBytes: number;
  expectedSha256: string;
  storageLocation: string;
  status: OfflineModelStatus;
  downloadedBytes: number;
  errorKind?: OfflineModelFailureKind;
  error?: string;
}

export interface SettingsView {
  mode: DesktopLlmMode;
  bundledAvailable: boolean;
  bundledModelIncluded: boolean;
  allowLan: boolean;
  lanAddresses: string[];
  offline: { baseUrl: string; model: string };
  online: { baseUrl: string; model: string };
  hasApiKey: boolean;
  encryptionAvailable: boolean;
  customModel: CustomModelView;
  customModels: CustomModelView[];
  customStorageBytes: number;
  customStorageLimitBytes: number;
  offlineModel: OfflineModelView;
  localModelFailure?: LocalModelFailure;
}

export interface SettingsPayload {
  mode: DesktopLlmMode;
  allowLan: boolean;
  offline: { baseUrl: string; model: string };
  online: { baseUrl: string; model: string; apiKey: string };
}

export interface GgufSelectionView {
  selectionId: string;
  filename: string;
  byteSize: number;
  ggufVersion: number;
  freeSpaceBytes: number;
  requiredSpaceBytes: number;
}

export type GgufImportStatus =
  | {
      operationId: string;
      state: "copying";
      copiedBytes: number;
      totalBytes: number;
      fraction: number;
    }
  | { operationId: string; state: "activating" }
  | {
      operationId: string;
      state: "completed";
      model: CustomModelMetadataView;
    }
  | {
      operationId: string;
      state: "cancelled" | "error";
      error?: string;
      imported?: boolean;
    };

export type OfflineModelDownloadStatus =
  | {
      operationId: string;
      state: "downloading";
      downloadedBytes: number;
      totalBytes: number;
      fraction: number;
    }
  | { operationId: string; state: "verifying" | "activating" }
  | {
      operationId: string;
      state: "completed";
      downloadedBytes: number;
      totalBytes: number;
    }
  | {
      operationId: string;
      state: "cancelled" | "error";
      errorKind: OfflineModelFailureKind;
      error?: string;
      downloaded?: boolean;
    };

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking"; manual?: boolean }
  | { state: "available"; version?: string }
  | { state: "not-available"; manual?: boolean }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version?: string }
  | { state: "error"; message: string };

export interface AppInfo {
  version: string;
  updatesSupported: boolean;
  updateStatus: UpdateStatus;
}

export interface EngramDesktopBridge {
  getSettings: () => Promise<SettingsView>;
  saveSettings: (payload: SettingsPayload) => Promise<{
    ok: boolean;
    error?: string;
    localModelFailure?: LocalModelFailure;
  }>;
  chooseGguf: () => Promise<
    | { ok: true; selection: GgufSelectionView }
    | { ok: false; cancelled?: boolean; error?: string }
  >;
  importGguf: (
    selectionId: string,
  ) => Promise<{ ok: boolean; operationId?: string; error?: string }>;
  cancelGgufImport: (
    operationId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  activateGguf: (sha256: string) => Promise<{ ok: boolean; error?: string }>;
  renameGguf: (
    sha256: string,
    displayName: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeGguf: (sha256?: string) => Promise<{ ok: boolean; error?: string }>;
  onGgufImportStatus: (
    callback: (status: GgufImportStatus) => void,
  ) => () => void;
  downloadOfflineModel: () => Promise<{
    ok: boolean;
    operationId?: string;
    error?: string;
  }>;
  cancelOfflineModelDownload: (
    operationId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeOfflineModel: () => Promise<{ ok: boolean; error?: string }>;
  onOfflineModelStatus: (
    callback: (status: OfflineModelDownloadStatus) => void,
  ) => () => void;
  close: () => Promise<void>;
  getUiLanguage: () => Promise<string>;
  setUiLanguage: (language: string) => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<void>;
  installDownloadedUpdate: () => Promise<{
    ok: boolean;
    error?: string;
  }>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
}

export interface RendererIpc {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(
    channel: string,
    listener: (event: unknown, payload: unknown) => void,
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: unknown, payload: unknown) => void,
  ): unknown;
}

export function createEngramDesktopBridge(
  ipc: RendererIpc,
): EngramDesktopBridge {
  return {
    getSettings: () => ipc.invoke("settings:get") as Promise<SettingsView>,
    saveSettings: (payload) =>
      ipc.invoke("settings:save", payload) as Promise<{
        ok: boolean;
        error?: string;
        localModelFailure?: LocalModelFailure;
      }>,
    chooseGguf: () =>
      ipc.invoke("gguf:choose") as ReturnType<
        EngramDesktopBridge["chooseGguf"]
      >,
    importGguf: (selectionId) =>
      ipc.invoke("gguf:import", selectionId) as ReturnType<
        EngramDesktopBridge["importGguf"]
      >,
    cancelGgufImport: (operationId) =>
      ipc.invoke("gguf:cancel", operationId) as ReturnType<
        EngramDesktopBridge["cancelGgufImport"]
      >,
    activateGguf: (sha256) =>
      ipc.invoke("gguf:activate", sha256) as ReturnType<
        EngramDesktopBridge["activateGguf"]
      >,
    renameGguf: (sha256, displayName) =>
      ipc.invoke("gguf:rename", sha256, displayName) as ReturnType<
        EngramDesktopBridge["renameGguf"]
      >,
    removeGguf: (sha256) =>
      ipc.invoke("gguf:remove", sha256) as ReturnType<
        EngramDesktopBridge["removeGguf"]
      >,
    onGgufImportStatus: (callback) => {
      const listener = (_event: unknown, payload: unknown): void =>
        callback(payload as GgufImportStatus);
      ipc.on("gguf:import-status", listener);
      return () => {
        ipc.removeListener("gguf:import-status", listener);
      };
    },
    downloadOfflineModel: () =>
      ipc.invoke("offline-model:download") as ReturnType<
        EngramDesktopBridge["downloadOfflineModel"]
      >,
    cancelOfflineModelDownload: (operationId) =>
      ipc.invoke("offline-model:cancel", operationId) as ReturnType<
        EngramDesktopBridge["cancelOfflineModelDownload"]
      >,
    removeOfflineModel: () =>
      ipc.invoke("offline-model:remove") as ReturnType<
        EngramDesktopBridge["removeOfflineModel"]
      >,
    onOfflineModelStatus: (callback) => {
      const listener = (_event: unknown, payload: unknown): void =>
        callback(payload as OfflineModelDownloadStatus);
      ipc.on("offline-model:status", listener);
      return () => {
        ipc.removeListener("offline-model:status", listener);
      };
    },
    close: () => ipc.invoke("settings:close") as Promise<void>,
    getUiLanguage: () => ipc.invoke("ui-language:get") as Promise<string>,
    setUiLanguage: (language) =>
      ipc.invoke("ui-language:set", language) as Promise<void>,
    getAppInfo: () => ipc.invoke("app:info") as Promise<AppInfo>,
    checkForUpdates: () => ipc.invoke("update:check") as Promise<void>,
    installDownloadedUpdate: () =>
      ipc.invoke("update:install") as ReturnType<
        EngramDesktopBridge["installDownloadedUpdate"]
      >,
    onUpdateStatus: (callback) => {
      const listener = (_event: unknown, payload: unknown): void =>
        callback(payload as UpdateStatus);
      ipc.on("update:status", listener);
      return () => {
        ipc.removeListener("update:status", listener);
      };
    },
  };
}
