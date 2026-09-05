export type DesktopLlmMode = "bundled" | "custom" | "offline" | "online";

export interface CustomModelMetadataView {
  filename: string;
  byteSize: number;
  sha256: string;
  ggufVersion: number;
  importedAt: string;
}

export interface CustomModelView {
  storageLocation: string;
  status: "none" | "available" | "active" | "missing" | "corrupt" | "error";
  error?: string;
  metadata?: CustomModelMetadataView;
}

export interface SettingsView {
  mode: DesktopLlmMode;
  bundledAvailable: boolean;
  allowLan: boolean;
  lanAddresses: string[];
  offline: { baseUrl: string; model: string };
  online: { baseUrl: string; model: string };
  hasApiKey: boolean;
  encryptionAvailable: boolean;
  customModel: CustomModelView;
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

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version?: string }
  | { state: "not-available" }
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
  saveSettings: (
    payload: SettingsPayload,
  ) => Promise<{ ok: boolean; error?: string }>;
  chooseGguf: () => Promise<
    { ok: true; selection: GgufSelectionView } | { ok: false; cancelled?: boolean; error?: string }
  >;
  importGguf: (
    selectionId: string,
  ) => Promise<{ ok: boolean; operationId?: string; error?: string }>;
  cancelGgufImport: (
    operationId: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  removeGguf: () => Promise<{ ok: boolean; error?: string }>;
  onGgufImportStatus: (
    callback: (status: GgufImportStatus) => void,
  ) => () => void;
  close: () => Promise<void>;
  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<void>;
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
    getSettings: () =>
      ipc.invoke("settings:get") as Promise<SettingsView>,
    saveSettings: (payload) =>
      ipc.invoke("settings:save", payload) as Promise<{
        ok: boolean;
        error?: string;
      }>,
    chooseGguf: () =>
      ipc.invoke("gguf:choose") as ReturnType<EngramDesktopBridge["chooseGguf"]>,
    importGguf: (selectionId) =>
      ipc.invoke(
        "gguf:import",
        selectionId,
      ) as ReturnType<EngramDesktopBridge["importGguf"]>,
    cancelGgufImport: (operationId) =>
      ipc.invoke(
        "gguf:cancel",
        operationId,
      ) as ReturnType<EngramDesktopBridge["cancelGgufImport"]>,
    removeGguf: () =>
      ipc.invoke("gguf:remove") as ReturnType<EngramDesktopBridge["removeGguf"]>,
    onGgufImportStatus: (callback) => {
      const listener = (_event: unknown, payload: unknown): void =>
        callback(payload as GgufImportStatus);
      ipc.on("gguf:import-status", listener);
      return () => {
        ipc.removeListener("gguf:import-status", listener);
      };
    },
    close: () => ipc.invoke("settings:close") as Promise<void>,
    getAppInfo: () => ipc.invoke("app:info") as Promise<AppInfo>,
    checkForUpdates: () => ipc.invoke("update:check") as Promise<void>,
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