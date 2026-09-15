import {
  app,
  BrowserWindow,
  clipboard,
  Menu,
  ipcMain,
  safeStorage,
  shell,
  dialog,
  type OpenDialogOptions,
} from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createServer } from "node:net";
import {
  stopProcess,
  installDownloadedUpdate,
  stopDesktopWork,
  createBeforeQuitHandler,
} from "./lifecycle";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import {
  CustomGgufStore,
  type CustomGgufMetadata,
  type GgufImportProgress,
} from "./custom-gguf";
import { buildLlamaCommand } from "./llama-command";
import { activateSettings } from "./settings-activation";
import {
  localModelFailureFromError,
  normalizeCustomGgufMetadata,
  normalizeLocalModelFailure,
  normalizeDesktopMode,
} from "./desktop-settings";
import type { LocalModelFailure } from "./desktop-settings";
import {
  downloadOfflineModel,
  classifyOfflineModelFailure,
  clearOfflineModelFailure,
  hasOfflineModelSync,
  offlineModelPartialPath,
  offlineModelPath,
  offlineModelStorageLocation,
  removeOfflineModel,
  recordOfflineModelFailure,
  offlineModelSpec,
  verifyOfflineModel,
} from "./offline-model";
import type { OfflineModelFailureKind } from "./offline-model";
import type {
  CustomModelMetadataView,
  GgufImportStatus,
  OfflineModelDownloadStatus,
  OfflineModelView,
  SettingsPayload,
  UpdateStatus,
} from "./desktop-bridge";
import {
  setupAutoUpdates as setupAutoUpdateFlow,
  DEFERRED_UPDATE_FAILURE_MESSAGE,
  UPDATE_INSTALL_FAILURE_MESSAGE,
  type AutoUpdaterLike,
} from "./auto-update";
import { createAppInfo, createUpdateStatusStore } from "./update-status";
import {
  appendBoundedDiagnostic,
  sanitizeDiagnosticText,
} from "./smoke-diagnostics";

// ---------------------------------------------------------------------------
// Paths. In a packaged app, bundled resources live under process.resourcesPath
// (see extraResources in electron-builder.yml). In an unpackaged dev run
// (`electron .`), they live under artifacts/desktop/resources (built by
// scripts/prepare-resources.mjs).
// ---------------------------------------------------------------------------
const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : path.join(__dirname, "..", "resources");

const serverEntry = path.join(resourcesDir, "server", "index.mjs");
const webDist = path.join(resourcesDir, "web");
const migrationsDir = path.join(resourcesDir, "drizzle");

// Bundled ffmpeg/ffprobe (staged by prepare-resources.mjs, shipped via
// extraResources). The embedded server spawns these for the VIDEO modality, so
// video perception works fully offline with no system ffmpeg install.
const ffmpegBin = path.join(
  resourcesDir,
  "bin",
  process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
);
const ffprobeBin = path.join(
  resourcesDir,
  "bin",
  process.platform === "win32" ? "ffprobe.exe" : "ffprobe",
);

// Bundled local LLM (llama.cpp server + GGUF model), staged by
// prepare-resources.mjs into resources/llama/. When present, the app can run
// chat/analysis/simulation fully offline with zero external setup.
const llamaBin = path.join(
  resourcesDir,
  "llama",
  "bin",
  process.platform === "win32" ? "llama-server.exe" : "llama-server",
);
const llamaModel = path.join(resourcesDir, "llama", "model.gguf");

// This is deliberately a CI-only packaged-smoke seam, not a user-facing
// fallback. It lets the release check substitute a downloaded, pinned
// compatible GGUF for the native file picker without distributing it inside
// the installer. The real picker remains the only production selection path.
// Normal packaged builds fail closed: neither variable has any effect unless
// the app is running in GitHub Actions' CI environment.
const packagedSmokeEnabled =
  app.isPackaged &&
  process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.ENGRAM_PACKAGED_GGUF_SMOKE === "1";
const packagedSmokeSimulatedFailure =
  packagedSmokeEnabled &&
  process.env.ENGRAM_PACKAGED_UPGRADE_FAIL_START === "1";
const packagedSmokeGguf = packagedSmokeEnabled
  ? process.env.ENGRAM_PACKAGED_GGUF_FIXTURE
  : undefined;
const packagedSmokeGgufSecondary = packagedSmokeEnabled
  ? process.env.ENGRAM_PACKAGED_GGUF_FIXTURE_B
  : undefined;
let packagedSmokeGgufSelectionCount = 0;
const packagedSmokeUsesRealRuntime =
  packagedSmokeEnabled && process.env.ENGRAM_PACKAGED_GGUF_REAL_RUNTIME === "1";
const packagedSmokeUpdateEnabled =
  packagedSmokeEnabled && process.env.ENGRAM_PACKAGED_UPDATE_SMOKE === "1";
const packagedSmokeUpdateFeedUrl =
  packagedSmokeUpdateEnabled &&
  process.env.ENGRAM_PACKAGED_UPDATE_FEED_URL?.trim();

const smokeDiagnosticsDir = process.env.ENGRAM_SMOKE_DIAGNOSTICS_DIR;
const smokeDiagnosticSecretValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      Boolean(value) &&
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(name),
  )
  .map(([, value]) => value!)
  .filter((value) => value.length >= 4);

function sanitizeSmokeDiagnostic(value: string): string {
  const replacements: Array<[string, string]> = [
    [process.env.GITHUB_WORKSPACE ?? "", "<workspace>"],
    [path.resolve(process.cwd()), "<workspace>"],
    [process.resourcesPath, "<resources>"],
    [os.tmpdir(), "<tmp>"],
    [os.homedir(), "<home>"],
  ];
  try {
    replacements.push([app.getPath("userData"), "<user-data>"]);
  } catch {
    // Electron may not expose userData until the app is ready.
  }
  return sanitizeDiagnosticText(
    value,
    replacements,
    smokeDiagnosticSecretValues,
  );
}

function appendSmokeDiagnostic(filename: string, value: string): void {
  if (!smokeDiagnosticsDir || !/^[a-z0-9._-]+$/i.test(filename)) return;
  try {
    appendBoundedDiagnostic(
      path.join(smokeDiagnosticsDir, filename),
      sanitizeSmokeDiagnostic(value),
    );
  } catch {
    // Diagnostics must never prevent the packaged app from starting.
  }
}

function createPackagedSmokeUpdater(): AutoUpdaterLike {
  const emitter = new EventEmitter();
  const updater = emitter as unknown as AutoUpdaterLike;
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.checkForUpdates = async () => {
    appendSmokeDiagnostic("update.log", "phase=feed-setup\n");
    emitter.emit("checking-for-update");
    emitter.emit("update-available", { version: "0.0.0-smoke" });
    appendSmokeDiagnostic("update.log", "phase=download-progress\n");
    emitter.emit("download-progress", {
      percent: 100,
      transferred: 1024,
      total: 1024,
      bytesPerSecond: 1024,
    });
    emitter.emit("update-downloaded", { version: "0.0.0-smoke" });
    appendSmokeDiagnostic("update.log", "phase=downloaded\n");
  };
  updater.quitAndInstall = () => {
    appendSmokeDiagnostic("update.log", "phase=quit-and-install\n");
  };
  return updater;
}

appendSmokeDiagnostic("main.log", "desktop main process initialized\n");

function bundledModelAvailable(): boolean {
  const spec = offlineModelSpec();
  return (
    existsSync(llamaBin) &&
    (existsSync(llamaModel) || hasOfflineModelSync(offlineModelRoot(), spec))
  );
}

function packagedBundledModelAvailable(): boolean {
  return existsSync(llamaBin) && existsSync(llamaModel);
}

function offlineModelRoot(): string {
  return userDataPath("models", "offline");
}

let serverProcess: ChildProcess | null = null;
let llamaProcess: ChildProcess | null = null;
let llamaPort = 0;
let llamaModelAlias = "bundled";
let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let currentPort = 0;
let quitting = false;
let updateController: ReturnType<typeof setupAutoUpdateFlow> = {
  checkForUpdatesManually: () => undefined,
  installDownloadedUpdate: async () => {
    throw new Error("No downloaded update is ready to install.");
  },
};

const RELEASE_DOWNLOAD_URL = "https://github.com/Tech953/Ch-IO/releases/latest";
const UPDATE_STATUS_FILE = "deferred-update-failure.json";

function updateStatusFilePath(): string {
  return userDataPath(UPDATE_STATUS_FILE);
}

function loadDeferredUpdateFailure(): UpdateStatus | null {
  try {
    const parsed = JSON.parse(
      readFileSync(updateStatusFilePath(), "utf8"),
    ) as { state?: unknown; deferred?: unknown; retryable?: unknown };
    if (
      parsed.state === "error" &&
      parsed.deferred === true &&
      parsed.retryable === true
    ) {
      return {
        state: "error",
        message: DEFERRED_UPDATE_FAILURE_MESSAGE,
        deferred: true,
        retryable: true,
      };
    }
  } catch {
    // Missing or malformed recovery state is equivalent to no prior failure.
  }
  return null;
}

function clearDeferredUpdateFailure(): void {
  try {
    rmSync(updateStatusFilePath(), { force: true });
  } catch {
    // Recovery state is best effort and must never block the app.
  }
}

const persistedDeferredUpdateFailure = loadDeferredUpdateFailure();
let hasPersistedDeferredUpdateFailure = Boolean(
  persistedDeferredUpdateFailure,
);

const updateStatusStore = createUpdateStatusStore(
  (status) => {
    for (const window of [mainWindow, settingsWindow]) {
      if (window && !window.isDestroyed()) {
        window.webContents.send("update:status", status);
      }
    }
  },
  persistedDeferredUpdateFailure ?? undefined,
);

function setUpdateStatus(status: UpdateStatus): void {
  if (
    hasPersistedDeferredUpdateFailure &&
    ((status.state === "checking" && !status.manual) ||
      (status.state === "error" && !status.deferred))
  ) {
    return;
  }
  if (
    (status.state === "checking" && status.manual) ||
    status.state === "available" ||
    status.state === "downloading" ||
    status.state === "downloaded" ||
    status.state === "not-available"
  ) {
    hasPersistedDeferredUpdateFailure = false;
    clearDeferredUpdateFailure();
  }
  if (status.state === "error" && status.deferred) {
    hasPersistedDeferredUpdateFailure = true;
    try {
      writeFileSync(
        updateStatusFilePath(),
        JSON.stringify({
          state: "error",
          deferred: true,
          retryable: true,
        }),
        { mode: 0o600 },
      );
    } catch {
      // The in-memory status still gives the current session recovery UI.
    }
  }
  updateStatusStore.set(status);
}

const WINDOW_TITLE = "ENGRAM — PYRI";

// Restore the main window title after an update-download progress indicator.
function resetWindowTitle(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(WINDOW_TITLE);
  }
}

function userDataPath(...segments: string[]): string {
  return path.join(app.getPath("userData"), ...segments);
}

// ---------------------------------------------------------------------------
// Settings: persisted to userData/settings.json. The online API key is stored
// encrypted via Electron safeStorage when the OS keychain is available, and
// only ever decrypted in-process to hand to the server child as LLM_API_KEY.
// If the OS keychain is unavailable, the key is NEVER written to disk: it is
// held in memory for the current session only (see sessionApiKey) and must be
// re-entered on the next launch.
// ---------------------------------------------------------------------------
interface Settings {
  mode: "bundled" | "custom" | "offline" | "online";
  uiLanguage: string;
  /** Listen on all interfaces so the mobile app can connect over LAN. */
  allowLan?: boolean;
  custom?: CustomGgufMetadata;
  customModels?: CustomGgufMetadata[];
  offline: { baseUrl: string; model: string };
  online: {
    baseUrl: string;
    model: string;
    apiKeyEnc?: string;
  };
  offlineModelFailure?: {
    kind: OfflineModelFailureKind;
    message: string;
  };
  localModelFailure?: LocalModelFailure;
}

// Online API key kept in memory only when the OS keychain is unavailable, so it
// is never persisted in plaintext. Cleared on quit; the user re-enters it next
// launch. When the keychain IS available the key lives in settings.apiKeyEnc.
let sessionApiKey: string | null = null;
let customStoreInstance: CustomGgufStore | null = null;
let customRuntimeFingerprint: string | null = null;
let customRuntimeError: string | null = null;

type PendingGgufSelection = {
  sourcePath: string;
  filename: string;
  expiresAt: number;
};

type RunningGgufImport = {
  controller: AbortController;
  promise: Promise<void>;
};

type RunningOfflineModelDownload = {
  controller: AbortController;
  promise: Promise<void>;
};

const GGUF_SELECTION_TTL_MS = 10 * 60 * 1000;
const pendingGgufSelections = new Map<string, PendingGgufSelection>();
const runningGgufImports = new Map<string, RunningGgufImport>();
const runningOfflineModelDownloads = new Map<
  string,
  RunningOfflineModelDownload
>();

function hasRunningModelOperation(): boolean {
  return runningGgufImports.size > 0 || runningOfflineModelDownloads.size > 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function attachLocalModelFailure(
  error: unknown,
  failure: LocalModelFailure,
): Error & { localModelFailure: LocalModelFailure } {
  const wrapped = error instanceof Error ? error : new Error(String(error));
  Object.defineProperty(wrapped, "localModelFailure", {
    configurable: true,
    enumerable: false,
    value: failure,
    writable: false,
  });
  return wrapped as Error & { localModelFailure: LocalModelFailure };
}

function localModelFailureOn(error: unknown): LocalModelFailure | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    localModelFailure?: unknown;
    primaryError?: unknown;
    cause?: unknown;
  };
  return (
    normalizeLocalModelFailure(candidate.localModelFailure) ??
    localModelFailureOn(candidate.primaryError) ??
    localModelFailureOn(candidate.cause)
  );
}

function normalizeOfflineModelFailure(
  value: unknown,
): Settings["offlineModelFailure"] {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as { kind?: unknown; message?: unknown };
  const kinds: OfflineModelFailureKind[] = [
    "checksum",
    "network",
    "cancelled",
    "storage",
    "unknown",
  ];
  if (
    typeof candidate.message !== "string" ||
    !kinds.includes(candidate.kind as OfflineModelFailureKind)
  ) {
    return undefined;
  }
  return {
    kind: candidate.kind as OfflineModelFailureKind,
    message: candidate.message,
  };
}

function safeGgufError(error: unknown, sourcePath?: string): string {
  const message = errorMessage(error);
  return sourcePath
    ? message.split(sourcePath).join("[selected GGUF]")
    : message;
}

function customMetadataView(
  metadata: CustomGgufMetadata,
): CustomModelMetadataView {
  return {
    filename: metadata.originalFilename,
    displayName: metadata.displayName ?? metadata.originalFilename,
    byteSize: metadata.byteSize,
    sha256: metadata.sha256,
    ggufVersion: metadata.ggufVersion,
    importedAt: metadata.importedAt,
    lastUsedAt: metadata.lastUsedAt ?? metadata.importedAt,
  };
}

function sendGgufImportStatus(status: GgufImportStatus): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("gguf:import-status", status);
  }
}

function sendOfflineModelStatus(status: OfflineModelDownloadStatus): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("offline-model:status", status);
  }
}

async function cancelAllDesktopDownloads(): Promise<void> {
  const operations = [
    ...runningGgufImports.values(),
    ...runningOfflineModelDownloads.values(),
  ];
  for (const entry of operations) entry.controller.abort();
  await Promise.allSettled(operations.map((entry) => entry.promise));
}

const DEFAULT_SETTINGS: Settings = {
  // "bundled" uses the built-in llama.cpp server + model shipped with the app
  // (fully offline, zero setup). Falls back to "offline" (external local
  // server) at runtime if the bundled files are missing from this build.
  mode: "bundled",
  uiLanguage: "en",
  offline: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
  online: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

function customGgufStore(): CustomGgufStore {
  customStoreInstance ??= new CustomGgufStore(userDataPath("models", "custom"));
  return customStoreInstance;
}

function managedCustomPath(metadata: CustomGgufMetadata): string {
  return path.join(customGgufStore().root, metadata.path);
}

/** The mode actually used at runtime: bundled degrades to offline only until
 * the packaged or user-downloaded model is available. */
function effectiveMode(settings: Settings): Settings["mode"] {
  if (settings.mode === "bundled" && !bundledModelAvailable()) return "offline";
  if (
    settings.mode === "custom" &&
    (!settings.custom || !existsSync(managedCustomPath(settings.custom)))
  ) {
    return "offline";
  }
  return settings.mode;
}

function settingsFile(): string {
  return userDataPath("settings.json");
}

function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsFile(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const legacyCustom = normalizeCustomGgufMetadata(parsed.custom);
    const customModels = [
      ...(Array.isArray(parsed.customModels)
        ? parsed.customModels
            .map(normalizeCustomGgufMetadata)
            .filter((model): model is CustomGgufMetadata => Boolean(model))
        : []),
      ...(legacyCustom ? [legacyCustom] : []),
    ].filter(
      (model, index, models) =>
        models.findIndex((candidate) => candidate.sha256 === model.sha256) ===
        index,
    );
    const selectedCustom =
      legacyCustom ??
      (normalizeDesktopMode(parsed.mode) === "custom"
        ? customModels[0]
        : undefined);
    return {
      mode: normalizeDesktopMode(parsed.mode),
      uiLanguage:
        typeof parsed.uiLanguage === "string" &&
        /^[a-z]{2}$/i.test(parsed.uiLanguage)
          ? parsed.uiLanguage.toLowerCase()
          : DEFAULT_SETTINGS.uiLanguage,
      allowLan: parsed.allowLan === true,
      custom: selectedCustom,
      customModels,
      offline: { ...DEFAULT_SETTINGS.offline, ...(parsed.offline ?? {}) },
      online: { ...DEFAULT_SETTINGS.online, ...(parsed.online ?? {}) },
      offlineModelFailure: normalizeOfflineModelFailure(
        parsed.offlineModelFailure,
      ),
      localModelFailure: normalizeLocalModelFailure(parsed.localModelFailure),
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function customModelsFor(settings: Settings): CustomGgufMetadata[] {
  const models = settings.customModels ?? [];
  if (
    settings.custom &&
    !models.some((model) => model.sha256 === settings.custom?.sha256)
  ) {
    return [settings.custom, ...models];
  }
  return models;
}

function selectedCustomFor(settings: Settings): CustomGgufMetadata | undefined {
  return settings.custom ?? customModelsFor(settings)[0];
}

function withCustomModels(
  settings: Settings,
  customModels: CustomGgufMetadata[],
  selected: CustomGgufMetadata | undefined,
): Settings {
  return {
    ...settings,
    custom: selected,
    customModels,
  };
}

function markCustomModelUsed(
  metadata: CustomGgufMetadata,
  now = new Date().toISOString(),
): CustomGgufMetadata {
  return {
    ...metadata,
    displayName: metadata.displayName ?? metadata.originalFilename,
    lastUsedAt: now,
  };
}

function saveSettings(settings: Settings): void {
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  const temporary = `${settingsFile()}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporary, settingsFile());
  } finally {
    rmSync(temporary, { force: true });
  }
}

function resolveApiKey(settings: Settings): string {
  if (settings.mode !== "online") return "local-placeholder";
  const online = settings.online;
  if (online.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(online.apiKeyEnc, "base64"));
    } catch {
      return "";
    }
  }
  return sessionApiKey ?? "";
}

function buildServerEnv(settings: Settings, port: number): NodeJS.ProcessEnv {
  const mode = effectiveMode(settings);
  const active =
    (mode === "bundled" || mode === "custom") && llamaProcess && llamaPort > 0
      ? {
          baseUrl: `http://127.0.0.1:${llamaPort}/v1`,
          model: llamaModelAlias,
        }
      : mode === "online"
        ? settings.online
        : settings.offline;
  const apiKey = resolveApiKey(settings) || "local-placeholder";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    ENGRAM_DB_DRIVER: "pglite",
    PGLITE_DATA_DIR: userDataPath("db"),
    DRIZZLE_MIGRATIONS_DIR: migrationsDir,
    WEB_DIST: webDist,
    // LAN access is opt-in: when enabled the embedded api-server listens on
    // all interfaces so the ENGRAM mobile app can connect from the same
    // network. The bundled llama-server always stays loopback-only.
    HOST: settings.allowLan ? "0.0.0.0" : "127.0.0.1",
    PORT: String(port),
    LLM_BASE_URL: active.baseUrl,
    LLM_MODEL: active.model,
    LLM_API_KEY: apiKey,
  };
  // Point the server child at the bundled ffmpeg/ffprobe when present so video
  // perception runs offline. If a binary is missing (e.g. a partial build), leave
  // the var unset so the extractor falls back to a system install on PATH.
  if (existsSync(ffmpegBin)) env.FFMPEG_PATH = ffmpegBin;
  if (existsSync(ffprobeBin)) env.FFPROBE_PATH = ffprobeBin;
  return env;
}

// ---------------------------------------------------------------------------
// Server child process lifecycle.
// ---------------------------------------------------------------------------
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = address && typeof address === "object" ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function waitForHealth(port: number, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  let lastFailure = "";
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/healthz", timeout: 2000 },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            body += chunk;
          });
          if (res.statusCode === 200) {
            resolve();
          } else {
            lastFailure = `HTTP ${res.statusCode}${body ? `: ${body.slice(0, 500)}` : ""}`;
            retry();
          }
        },
      );
      req.on("error", (error) => {
        lastFailure = error.message;
        retry();
      });
      req.on("timeout", () => {
        req.destroy();
        lastFailure = "request timed out";
        retry();
      });
    };
    const retry = (): void => {
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Embedded server did not become healthy in time.${lastFailure ? ` Last check: ${lastFailure}.` : ""}`,
          ),
        );
      } else {
        setTimeout(attempt, 500);
      }
    };
    attempt();
  });
}

// Wait for llama-server's /health to report {"status":"ok"}. First launch can
// take a while (the model is memory-mapped and warmed), so the timeout is
// generous.
function waitForLlamaHealth(port: number, timeoutMs = 300000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health", timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = (): void => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Local model server did not become ready in time."));
      } else {
        setTimeout(attempt, 1000);
      }
    };
    attempt();
  });
}

async function startLlama(settings: Settings): Promise<void> {
  const mode = effectiveMode(settings);
  let modelPath = llamaModel;
  let verifiedCustom:
    | Awaited<ReturnType<CustomGgufStore["verifyForLaunch"]>>
    | undefined;
  llamaModelAlias = "bundled";
  if (mode === "custom") {
    if (!settings.custom) {
      throw new Error("No imported custom GGUF model is configured.");
    }
    customRuntimeError = null;
    verifiedCustom = await customGgufStore().verifyForLaunch(settings.custom);
    modelPath = verifiedCustom.path;
    llamaModelAlias = `custom-${settings.custom.sha256.slice(0, 12)}`;
  } else if (mode === "bundled" && !packagedBundledModelAvailable()) {
    const spec = offlineModelSpec();
    const verifiedDownloaded = await verifyOfflineModel(
      offlineModelRoot(),
      spec,
    );
    modelPath = verifiedDownloaded.path;
    llamaModelAlias = `downloaded-${spec.sha256.slice(0, 12)}`;
  }
  llamaPort = await findFreePort();
  if (
    packagedSmokeEnabled &&
    !(packagedSmokeUsesRealRuntime && mode === "custom")
  ) {
    // A minimal loopback-only llama health endpoint is sufficient for the
    // desktop's launch contract. It is never reachable in production because
    // packagedSmokeEnabled is CI-gated above; custom GGUF verification still
    // happened before this branch.
    const fixtureRuntime = [
      "const http=require('node:http');",
      "const port=Number(process.argv[1]);",
      "http.createServer((req,res)=>{",
      "if(req.url==='/health'){res.writeHead(200,{'content-type':'application/json'});return res.end('{\"status\":\"ok\"}');}",
      "res.writeHead(404);res.end();",
      "}).listen(port,'127.0.0.1');",
    ].join("");
    const proc = spawn(
      process.execPath,
      ["-e", fixtureRuntime, String(llamaPort)],
      {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    llamaProcess = proc;
    await waitForLlamaHealth(llamaPort);
    if (mode === "custom" && settings.custom) {
      customRuntimeFingerprint = settings.custom.sha256;
      customRuntimeError = null;
    }
    return;
  }
  const command = buildLlamaCommand({
    executablePath: llamaBin,
    modelPath,
    port: llamaPort,
    context: 8192,
  });
  if (verifiedCustom) {
    // The model store is owner-only. Recheck the exact file identity as the
    // final operation before shell-free spawn to close the verification gap as
    // tightly as cross-platform pathname-based llama.cpp launching permits.
    await customGgufStore().assertLaunchIdentity(verifiedCustom);
  }
  const proc = spawn(llamaBin, command.args, {
    // cwd = bin dir so the llama.cpp shared libraries/DLLs next to the
    // executable resolve on every platform.
    cwd: command.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  llamaProcess = proc;
  let startupStderr = "";
  proc.stdout?.on("data", (chunk: Buffer) => {
    const output = sanitizeSmokeDiagnostic(chunk.toString());
    appendSmokeDiagnostic("llama.stdout.log", output);
    process.stdout.write(`[llama] ${output}`);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    const output = sanitizeSmokeDiagnostic(chunk.toString());
    startupStderr = `${startupStderr}${output}`.slice(-12_000);
    appendSmokeDiagnostic("llama.stderr.log", output);
    process.stderr.write(`[llama] ${output}`);
  });
  const startupError = (message: string): Error => {
    const failure = localModelFailureFromError(
      new Error(`${message}${startupStderr ? ` ${startupStderr.trim()}` : ""}`),
      process.platform,
      startupStderr,
    );
    return attachLocalModelFailure(new Error(failure.message), failure);
  };
  // Startup is transactional: any spawn error or early exit before health
  // rejects the promise, and the caller cleans up + falls back. `settled`
  // guards double-settlement between the racing handlers.
  let settled = false;
  const spawnFailure = new Promise<never>((_, reject) => {
    proc.on("error", (err) => {
      if (llamaProcess === proc) {
        llamaProcess = null;
        customRuntimeFingerprint = null;
      }
      if (!settled) {
        settled = true;
        appendSmokeDiagnostic(
          "main.log",
          `llama spawn error: ${sanitizeSmokeDiagnostic(err.message)}\n`,
        );
        reject(
          startupError(`Local model server failed to start: ${err.message}`),
        );
      }
    });
    proc.on("exit", (code, signal) => {
      if (llamaProcess === proc) {
        llamaProcess = null;
        customRuntimeFingerprint = null;
      }
      if (!settled) {
        settled = true;
        appendSmokeDiagnostic(
          "main.log",
          `llama exited before health: code=${code}, signal=${signal}\n`,
        );
        reject(
          startupError(
            `Local model server exited before becoming ready (code=${code}, signal=${signal}).`,
          ),
        );
      } else if (!quitting) {
        appendSmokeDiagnostic(
          "main.log",
          `llama exited unexpectedly: code=${code}, signal=${signal}\n`,
        );
        // eslint-disable-next-line no-console
        console.error(
          `[desktop] bundled model server exited unexpectedly (code=${code}, signal=${signal}).`,
        );
      }
    });
  });
  try {
    await Promise.race([waitForLlamaHealth(llamaPort), spawnFailure]);
    settled = true;
    if (mode === "custom" && settings.custom) {
      customRuntimeFingerprint = settings.custom.sha256;
      customRuntimeError = null;
    }
  } catch (err) {
    settled = true;
    await stopLlama();
    if (localModelFailureOn(err)) throw err;
    const failure = localModelFailureFromError(
      err,
      process.platform,
      startupStderr,
    );
    throw attachLocalModelFailure(err, failure);
  }
}

function stopLlama(): Promise<void> {
  const proc = llamaProcess;
  if (!proc) return Promise.resolve();
  llamaProcess = null;
  customRuntimeFingerprint = null;
  return stopProcess(proc);
}

async function startServer(
  settings = loadSettings(),
  options: { strictLocalModel?: boolean } = {},
): Promise<void> {
  appendSmokeDiagnostic(
    "main.log",
    `starting embedded server; entry=${serverEntry}, resources=${resourcesDir}\n`,
  );
  if (!existsSync(serverEntry)) {
    throw new Error(
      `Server bundle not found at ${serverEntry}. Run the desktop build (pnpm --filter @workspace/desktop run build) first.`,
    );
  }
  mkdirSync(userDataPath("db"), { recursive: true });
  // Bundled mode: bring up the built-in model server first so its port is
  // known when the api-server env is built. A llama startup failure never
  // blocks the app — buildServerEnv degrades to the external local-server
  // settings when no llama process is live, so the UI still opens and the
  // user can pick another mode.
  const mode = effectiveMode(settings);
  let localModelFailure: LocalModelFailure | undefined;
  if ((mode === "bundled" || mode === "custom") && !llamaProcess) {
    try {
      await startLlama(settings);
    } catch (err) {
      const failure =
        localModelFailureOn(err) ??
        localModelFailureFromError(err, process.platform);
      localModelFailure = failure;
      const failureError = attachLocalModelFailure(err, failure);
      try {
        saveSettings({ ...settings, localModelFailure: failure });
      } catch (persistError) {
        console.error(
          "[desktop] could not persist local model startup failure:",
          persistError,
        );
      }
      if (mode === "custom") customRuntimeError = failure.message;
      // eslint-disable-next-line no-console
      console.error(
        "[desktop] local model unavailable, falling back:",
        sanitizeSmokeDiagnostic(errorMessage(failureError)),
      );
      if (options.strictLocalModel) throw failureError;
    }
  }
  currentPort = await findFreePort();
  const env = buildServerEnv(settings, currentPort);

  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let startupStderr = "";
  let startupSettled = false;
  const rememberStartupStderr = (chunk: Buffer): void => {
    const output = sanitizeSmokeDiagnostic(chunk.toString());
    startupStderr = `${startupStderr}${output}`.slice(-12_000);
    appendSmokeDiagnostic("server.stderr.log", output);
  };
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    const output = sanitizeSmokeDiagnostic(chunk.toString());
    appendSmokeDiagnostic("server.stdout.log", output);
    process.stdout.write(`[server] ${output}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    rememberStartupStderr(chunk);
    process.stderr.write(
      `[server] ${sanitizeSmokeDiagnostic(chunk.toString())}`,
    );
  });
  const serverFailure = new Promise<never>((_, reject) => {
    serverProcess?.on("error", (error) => {
      if (startupSettled) return;
      startupSettled = true;
      appendSmokeDiagnostic(
        "main.log",
        `embedded server spawn error: ${error.message}\n`,
      );
      reject(new Error(`Embedded server failed to start: ${error.message}`));
    });
    serverProcess?.on("exit", (code, signal) => {
      if (serverProcess) serverProcess = null;
      if (startupSettled) {
        if (!quitting) {
          appendSmokeDiagnostic(
            "main.log",
            `embedded server exited unexpectedly: code=${code}, signal=${signal}\n`,
          );
          // eslint-disable-next-line no-console
          console.error(
            `[desktop] server process exited unexpectedly (code=${code}, signal=${signal}).`,
          );
        }
        return;
      }
      startupSettled = true;
      appendSmokeDiagnostic(
        "main.log",
        `embedded server exited before health: code=${code}, signal=${signal}\n`,
      );
      const details = startupStderr.trim()
        ? `\n\nServer output:\n${startupStderr.trim()}`
        : "";
      reject(
        new Error(
          `Embedded server exited before becoming healthy (code=${code}, signal=${signal}).${details}`,
        ),
      );
    });
  });

  try {
    // Windows Defender and first-run PGlite initialization can make the
    // embedded child take substantially longer than a warm Linux launch.
    await Promise.race([
      waitForHealth(
        currentPort,
        process.platform === "win32" ? 180_000 : 60_000,
      ),
      serverFailure,
    ]);
    startupSettled = true;
    const persisted = loadSettings();
    if (!localModelFailure && persisted.localModelFailure) {
      saveSettings({ ...persisted, localModelFailure: undefined });
    }
  } catch (error) {
    startupSettled = true;
    appendSmokeDiagnostic(
      "main.log",
      `embedded server health/startup failure: ${errorMessage(error)}\n`,
    );
    await stopServer();
    throw error;
  }
}

function stopServer(): Promise<void> {
  const proc = serverProcess;
  if (!proc) return Promise.resolve();
  serverProcess = null;
  // Shared SIGTERM→SIGKILL shutdown used by both normal quit and the auto-update
  // install path, so the embedded server (and its PGlite DB) is always closed
  // cleanly before app files are swapped.
  return stopProcess(proc).then(() => {
    if (packagedSmokeUpdateEnabled) {
      appendSmokeDiagnostic("update.log", "phase=server-stopped\n");
    }
  });
}

async function activateDesktopSettings(
  previous: Settings,
  candidate: Settings,
): Promise<void> {
  await activateSettings(previous, candidate, {
    stop: () =>
      stopDesktopWork({
        stopImports: async () => {},
        stopServer,
        stopLlama,
      }),
    start: (settings) =>
      startServer(settings, {
        strictLocalModel:
          effectiveMode(settings) === "bundled" ||
          effectiveMode(settings) === "custom",
      }),
    persist: async (settings) => saveSettings(settings),
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    // Window refresh is presentation only. The provider is already healthy and
    // committed, so a navigation failure must never roll back or delete it.
    void mainWindow
      .loadURL(`http://127.0.0.1:${currentPort}/`)
      .catch((error) =>
        console.error("[desktop] main window reload failed:", error),
      );
  }
}

// ---------------------------------------------------------------------------
// Windows + menu.
// ---------------------------------------------------------------------------
function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#070b12",
    title: WINDOW_TITLE,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  void mainWindow.loadURL(`http://127.0.0.1:${currentPort}/`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1")) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function getCustomModelView(
  settings: Settings,
  model: CustomGgufMetadata,
) {
  const storageLocation = customGgufStore().root;
  const metadata = customMetadataView(model);
  const selected = selectedCustomFor(settings);
  if (
    customRuntimeFingerprint === model.sha256 &&
    llamaProcess &&
    effectiveMode(settings) === "custom" &&
    selected?.sha256 === model.sha256
  ) {
    return {
      storageLocation,
      status: "active" as const,
      compatibility: "compatible" as const,
      metadata,
    };
  }

  try {
    await customGgufStore().verifyBeforeUse(model);
    if (customRuntimeError && selected?.sha256 === model.sha256) {
      return {
        storageLocation,
        status: "error" as const,
        compatibility: "incompatible" as const,
        error: customRuntimeError,
        metadata,
      };
    }
    return {
      storageLocation,
      status: "available" as const,
      compatibility: "compatible" as const,
      metadata,
    };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    return {
      storageLocation,
      status: code === "ENOENT" ? ("missing" as const) : ("corrupt" as const),
      compatibility: "incompatible" as const,
      error: errorMessage(error),
      metadata,
    };
  }
}

async function getCustomModelViews(settings: Settings) {
  return Promise.all(
    customModelsFor(settings).map((model) =>
      getCustomModelView(settings, model),
    ),
  );
}

async function getOfflineModelView(
  settings: Settings,
): Promise<OfflineModelView> {
  const root = offlineModelRoot();
  const spec = offlineModelSpec();
  let downloadedBytes = 0;
  try {
    downloadedBytes = statSync(offlineModelPath(root, spec)).size;
  } catch {
    try {
      downloadedBytes = statSync(offlineModelPartialPath(root, spec)).size;
    } catch {
      downloadedBytes = 0;
    }
  }

  const usingDownloadedModel =
    settings.mode === "bundled" &&
    !packagedBundledModelAvailable() &&
    Boolean(llamaProcess) &&
    llamaModelAlias.startsWith("downloaded-");
  let status: OfflineModelView["status"] =
    downloadedBytes === 0 ? "none" : "downloading";
  let error: string | undefined;
  let errorKind: OfflineModelFailureKind | undefined;
  try {
    if (hasOfflineModelSync(root, spec)) {
      status = usingDownloadedModel ? "active" : "available";
    } else if (downloadedBytes > 0) {
      status = "partial";
      error = "A partial download is available and can be resumed.";
    }
  } catch (viewError) {
    status = "error";
    error = errorMessage(viewError);
    errorKind = classifyOfflineModelFailure(viewError);
  }
  if (settings.offlineModelFailure) {
    error = settings.offlineModelFailure.message;
    errorKind = settings.offlineModelFailure.kind;
  }
  return {
    filename: spec.filename,
    expectedBytes: spec.expectedBytes,
    expectedSha256: spec.sha256,
    storageLocation: offlineModelStorageLocation(root),
    status,
    downloadedBytes,
    ...(errorKind ? { errorKind } : {}),
    ...(error ? { error } : {}),
  };
}

async function runOfflineModelDownload(
  operationId: string,
  controller: AbortController,
): Promise<void> {
  let downloaded = false;
  try {
    const spec = offlineModelSpec();
    const verified = await downloadOfflineModel(offlineModelRoot(), {
      spec,
      signal: controller.signal,
      onProgress: (progress) => {
        sendOfflineModelStatus({
          operationId,
          state: "downloading",
          downloadedBytes: progress.downloadedBytes,
          totalBytes: progress.totalBytes,
          fraction: progress.fraction,
        });
      },
    });
    downloaded = true;
    sendOfflineModelStatus({ operationId, state: "verifying" });
    await verifyOfflineModel(offlineModelRoot(), spec);

    sendOfflineModelStatus({ operationId, state: "activating" });
    const previous = loadSettings();
    await activateDesktopSettings(
      previous,
      clearOfflineModelFailure({ ...previous, mode: "bundled" }),
    );
    sendOfflineModelStatus({
      operationId,
      state: "completed",
      downloadedBytes: verified.size,
      totalBytes: spec.expectedBytes,
    });
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    const errorKind: OfflineModelFailureKind = cancelled
      ? "cancelled"
      : classifyOfflineModelFailure(error);
    const failureMessage = cancelled
      ? "Offline model download was cancelled. The partial download is safe to resume."
      : errorMessage(error);
    try {
      const previous = loadSettings();
      saveSettings(
        recordOfflineModelFailure(previous, {
          kind: errorKind,
          message: failureMessage,
        }),
      );
    } catch {
      // The download result remains visible through the IPC status even if the
      // settings file cannot record the last failure.
    }
    sendOfflineModelStatus({
      operationId,
      state: cancelled ? "cancelled" : "error",
      errorKind,
      error: failureMessage,
      downloaded,
    });
  } finally {
    runningOfflineModelDownloads.delete(operationId);
  }
}

async function runGgufImport(
  operationId: string,
  selection: PendingGgufSelection,
  controller: AbortController,
): Promise<void> {
  let imported: CustomGgufMetadata | undefined;
  try {
    imported = await customGgufStore().importModel(selection.sourcePath, {
      signal: controller.signal,
      onProgress: (progress: GgufImportProgress) => {
        sendGgufImportStatus({
          operationId,
          state: "copying",
          ...progress,
        });
      },
    });

    sendGgufImportStatus({ operationId, state: "activating" });
    const previous = loadSettings();
    const existing = customModelsFor(previous).find(
      (model) => model.sha256 === imported?.sha256,
    );
    const importedModel = existing ?? markCustomModelUsed(imported);
    const customModels = existing
      ? customModelsFor(previous).map((model) =>
          model.sha256 === existing.sha256 ? markCustomModelUsed(model) : model,
        )
      : [...customModelsFor(previous), importedModel];
    const candidate: Settings = {
      ...previous,
      mode: "custom",
      custom: importedModel,
      customModels,
    };

    try {
      await activateDesktopSettings(previous, candidate);
    } catch (error) {
      const failure = localModelFailureOn(error);
      customRuntimeError = failure?.message ?? errorMessage(error);
      // Keep every validated import discoverable for explicit retry/removal,
      // while the previous provider remains active after a failed activation.
      saveSettings({
        ...previous,
        custom: previous.mode === "custom" ? previous.custom : importedModel,
        customModels,
        ...(failure ? { localModelFailure: failure } : {}),
      });
      sendGgufImportStatus({
        operationId,
        state: "error",
        error: failure?.message ?? errorMessage(error),
        imported: true,
      });
      return;
    }
    sendGgufImportStatus({
      operationId,
      state: "completed",
      model: customMetadataView(importedModel),
    });
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    sendGgufImportStatus({
      operationId,
      state: cancelled ? "cancelled" : "error",
      error: cancelled ? undefined : safeGgufError(error, selection.sourcePath),
      imported: false,
    });
  } finally {
    runningGgufImports.delete(operationId);
  }
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 640,
    height: 820,
    minWidth: 560,
    minHeight: 680,
    resizable: true,
    minimizable: false,
    maximizable: false,
    parent: mainWindow ?? undefined,
    modal: true,
    backgroundColor: "#070b12",
    title: "ENGRAM — Settings",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  void settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              {
                label: "Settings…",
                accelerator: "Cmd+,",
                click: openSettingsWindow,
              },
              {
                label: "Check for Updates…",
                click: checkForUpdatesManually,
              },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: openSettingsWindow,
        },
        {
          label: "Check for Updates…",
          click: checkForUpdatesManually,
        },
        { type: "separator" as const },
        isMac ? { role: "close" as const } : { role: "quit" as const },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        { type: "separator" as const },
        { role: "resetZoom" as const },
        { role: "zoomIn" as const },
        { role: "zoomOut" as const },
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
        { role: "toggleDevTools" as const },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// IPC: settings get/save/close.
// ---------------------------------------------------------------------------
ipcMain.handle("settings:get", async () => {
  const settings = loadSettings();
  const customModels = await getCustomModelViews(settings);
  const selectedCustom = selectedCustomFor(settings);
  const customModel =
    customModels.find(
      (model) => model.metadata?.sha256 === selectedCustom?.sha256,
    ) ??
    ({
      storageLocation: customGgufStore().root,
      status: "none",
      compatibility: "unknown",
    } as const);
  return {
    mode: settings.mode,
    bundledAvailable: bundledModelAvailable(),
    bundledModelIncluded: packagedBundledModelAvailable(),
    allowLan: settings.allowLan === true,
    // These are origin-only addresses accepted by the web Settings local-server
    // field. Keep loopback visible for this desktop, then add usable LAN IPv4
    // interfaces for phones and other devices on the same network.
    lanAddresses: [
      `http://127.0.0.1:${currentPort}`,
      ...(settings.allowLan
        ? Object.values(os.networkInterfaces())
            .flat()
            .filter((i) => i && i.family === "IPv4" && !i.internal)
            .map(
              (i) =>
                `http://${(i as os.NetworkInterfaceInfo).address}:${currentPort}`,
            )
        : []),
    ].filter((address, index, addresses) => addresses.indexOf(address) === index),
    offline: settings.offline,
    online: {
      baseUrl: settings.online.baseUrl,
      model: settings.online.model,
    },
    hasApiKey: Boolean(settings.online.apiKeyEnc) || Boolean(sessionApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    customModel,
    customModels,
    customStorageBytes: await customGgufStore().getManagedBytes(),
    customStorageLimitBytes: customGgufStore().storageLimitBytes,
    offlineModel: await getOfflineModelView(settings),
    localModelFailure: settings.localModelFailure,
  };
});

ipcMain.handle("clipboard:write", (_event, text: unknown) => {
  if (typeof text !== "string" || !text.trim()) {
    return { ok: false, error: "Nothing to copy." };
  }
  try {
    clipboard.writeText(text);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Clipboard unavailable.",
    };
  }
});

ipcMain.handle("settings:save", async (_event, payload: SettingsPayload) => {
  let previous: Settings | undefined;
  let next: Settings | undefined;
  let activationAttempted = false;
  try {
    if (hasRunningModelOperation()) {
      throw new Error("Wait for the GGUF import to finish or cancel it first.");
    }
    if (
      !payload ||
      !["bundled", "custom", "offline", "online"].includes(payload.mode) ||
      !payload.offline ||
      !payload.online
    ) {
      throw new Error("Invalid settings payload.");
    }
    previous = loadSettings();
    next = {
      mode: normalizeDesktopMode(payload.mode),
      uiLanguage: previous.uiLanguage,
      allowLan: payload.allowLan === true,
      custom: previous.custom,
      customModels: customModelsFor(previous),
      offline: {
        baseUrl:
          String(payload.offline.baseUrl ?? "")
            .trim()
            .slice(0, 2048) || DEFAULT_SETTINGS.offline.baseUrl,
        model:
          String(payload.offline.model ?? "")
            .trim()
            .slice(0, 512) || DEFAULT_SETTINGS.offline.model,
      },
      online: {
        baseUrl:
          String(payload.online.baseUrl ?? "")
            .trim()
            .slice(0, 2048) || DEFAULT_SETTINGS.online.baseUrl,
        model:
          String(payload.online.model ?? "")
            .trim()
            .slice(0, 512) || DEFAULT_SETTINGS.online.model,
        apiKeyEnc: previous.online.apiKeyEnc,
      },
      localModelFailure: undefined,
    };
    if (next.mode === "custom" && !next.custom) {
      throw new Error("Import a GGUF model before selecting Custom GGUF.");
    }

    const previousSessionApiKey = sessionApiKey;
    const newKey = String(payload.online.apiKey ?? "").slice(0, 8192);
    if (typeof newKey === "string" && newKey.length > 0) {
      if (safeStorage.isEncryptionAvailable()) {
        next.online.apiKeyEnc = safeStorage
          .encryptString(newKey)
          .toString("base64");
        sessionApiKey = null;
      } else {
        // No OS keychain: hold the key in memory for this session only.
        // It is intentionally never written to settings.json in plaintext.
        sessionApiKey = newKey;
        delete next.online.apiKeyEnc;
      }
    }

    try {
      activationAttempted = true;
      await activateDesktopSettings(previous, next);
    } catch (error) {
      sessionApiKey = previousSessionApiKey;
      throw error;
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
    return { ok: true };
  } catch (error) {
    const failure =
      activationAttempted &&
      next &&
      (next.mode === "bundled" || next.mode === "custom")
        ? localModelFailureOn(error)
        : undefined;
    if (failure && previous) {
      try {
        saveSettings({ ...previous, localModelFailure: failure });
      } catch (persistError) {
        console.error(
          "[desktop] could not persist local model activation failure:",
          persistError,
        );
      }
    }
    return {
      ok: false,
      error: failure?.message ?? errorMessage(error),
      ...(failure ? { localModelFailure: failure } : {}),
    };
  }
});

ipcMain.handle("gguf:choose", async () => {
  let sourcePath: string | undefined;
  try {
    if (hasRunningModelOperation()) {
      throw new Error("A GGUF import is already running.");
    }
    for (const [id, selection] of pendingGgufSelections) {
      if (selection.expiresAt < Date.now()) pendingGgufSelections.delete(id);
    }
    if (packagedSmokeGguf) {
      // CI substitutes only the result of the native picker. The absolute
      // source path stays in the main process and is never included in the
      // renderer-facing selection payload.
      const smokeFixture =
        packagedSmokeGgufSecondary && packagedSmokeGgufSelectionCount >= 2
          ? packagedSmokeGgufSecondary
          : packagedSmokeGguf;
      packagedSmokeGgufSelectionCount += 1;
      if (!path.isAbsolute(smokeFixture)) {
        throw new Error(
          "Packaged GGUF smoke fixture must be an absolute path.",
        );
      }
      sourcePath = smokeFixture;
    } else {
      const options: OpenDialogOptions = {
        title: "Choose a GGUF model",
        buttonLabel: "Choose model",
        properties: ["openFile"],
        filters: [{ name: "GGUF model", extensions: ["gguf"] }],
      };
      const result =
        settingsWindow && !settingsWindow.isDestroyed()
          ? await dialog.showOpenDialog(settingsWindow, options)
          : await dialog.showOpenDialog(options);
      if (result.canceled || result.filePaths.length !== 1) {
        return { ok: false, cancelled: true };
      }
      sourcePath = result.filePaths[0]!;
    }

    const inspection = await customGgufStore().inspectForImport(sourcePath);
    const selectionId = randomUUID();
    pendingGgufSelections.set(selectionId, {
      sourcePath,
      filename: path.basename(sourcePath),
      expiresAt: Date.now() + GGUF_SELECTION_TTL_MS,
    });
    return {
      ok: true,
      selection: {
        selectionId,
        filename: path.basename(sourcePath),
        ...inspection,
      },
    };
  } catch (error) {
    return { ok: false, error: safeGgufError(error, sourcePath) };
  }
});

ipcMain.handle("gguf:import", (_event, selectionId: unknown) => {
  try {
    if (typeof selectionId !== "string" || selectionId.length > 128) {
      throw new Error("Invalid GGUF selection.");
    }
    if (hasRunningModelOperation()) {
      throw new Error("A GGUF import is already running.");
    }
    const selection = pendingGgufSelections.get(selectionId);
    pendingGgufSelections.delete(selectionId);
    if (!selection || selection.expiresAt < Date.now()) {
      throw new Error("That GGUF selection expired. Choose the file again.");
    }

    const operationId = randomUUID();
    const controller = new AbortController();
    const entry: RunningGgufImport = {
      controller,
      promise: Promise.resolve(),
    };
    runningGgufImports.set(operationId, entry);
    entry.promise = runGgufImport(operationId, selection, controller);
    return { ok: true, operationId };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
});

ipcMain.handle("gguf:cancel", (_event, operationId: unknown) => {
  if (typeof operationId !== "string" || operationId.length > 128) {
    return { ok: false, error: "Invalid GGUF import." };
  }
  const entry = runningGgufImports.get(operationId);
  if (!entry)
    return { ok: false, error: "That GGUF import is no longer running." };
  entry.controller.abort();
  return { ok: true };
});

function findCustomModel(
  settings: Settings,
  sha256: unknown,
): CustomGgufMetadata {
  if (typeof sha256 !== "string" || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error("Invalid managed GGUF fingerprint.");
  }
  const model = customModelsFor(settings).find(
    (candidate) => candidate.sha256 === sha256,
  );
  if (!model) throw new Error("That managed GGUF is not in the model library.");
  return model;
}

ipcMain.handle("gguf:activate", async (_event, sha256: unknown) => {
  try {
    if (hasRunningModelOperation()) {
      throw new Error("Wait for the GGUF import to finish or cancel it first.");
    }
    const previous = loadSettings();
    const model = markCustomModelUsed(findCustomModel(previous, sha256));
    const customModels = customModelsFor(previous).map((candidate) =>
      candidate.sha256 === model.sha256 ? model : candidate,
    );
    await activateDesktopSettings(
      previous,
      withCustomModels({ ...previous, mode: "custom" }, customModels, model),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
});

ipcMain.handle(
  "gguf:rename",
  async (_event, sha256: unknown, displayName: unknown) => {
    try {
      const previous = loadSettings();
      const model = findCustomModel(previous, sha256);
      if (
        typeof displayName !== "string" ||
        displayName.trim().length === 0 ||
        displayName.length > 128
      ) {
        throw new Error("Model name must be 1–128 characters.");
      }
      const renamed = {
        ...model,
        displayName: displayName.trim(),
      };
      const customModels = customModelsFor(previous).map((candidate) =>
        candidate.sha256 === model.sha256 ? renamed : candidate,
      );
      saveSettings(
        withCustomModels(
          previous,
          customModels,
          previous.custom?.sha256 === model.sha256 ? renamed : previous.custom,
        ),
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, error: errorMessage(error) };
    }
  },
);

ipcMain.handle("gguf:remove", async (_event, sha256?: unknown) => {
  try {
    if (hasRunningModelOperation()) {
      throw new Error("Wait for the GGUF import to finish or cancel it first.");
    }
    const previous = loadSettings();
    const model = findCustomModel(previous, sha256 ?? previous.custom?.sha256);
    const remaining = customModelsFor(previous).filter(
      (candidate) => candidate.sha256 !== model.sha256,
    );
    const nextSelected =
      remaining
        .slice()
        .sort(
          (a, b) =>
            Date.parse(b.lastUsedAt ?? b.importedAt) -
            Date.parse(a.lastUsedAt ?? a.importedAt),
        )[0] ?? undefined;

    let deactivated = previous;
    if (
      previous.mode === "custom" &&
      previous.custom?.sha256 === model.sha256
    ) {
      deactivated = {
        ...previous,
        mode: bundledModelAvailable() ? "bundled" : "offline",
        custom: nextSelected,
        customModels: remaining,
      };
      await activateDesktopSettings(previous, deactivated);
    } else {
      deactivated = withCustomModels(previous, remaining, nextSelected);
    }

    try {
      await customGgufStore().discard(model);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "ENOENT") throw error;
    }
    saveSettings(deactivated);
    customRuntimeError = null;
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
});

ipcMain.handle("offline-model:download", () => {
  try {
    if (runningOfflineModelDownloads.size > 0) {
      throw new Error("An offline model download is already running.");
    }
    const previous = loadSettings();
    saveSettings(clearOfflineModelFailure(previous));
    const operationId = randomUUID();
    const controller = new AbortController();
    const entry: RunningOfflineModelDownload = {
      controller,
      promise: Promise.resolve(),
    };
    runningOfflineModelDownloads.set(operationId, entry);
    entry.promise = runOfflineModelDownload(operationId, controller);
    return { ok: true, operationId };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
});

ipcMain.handle("offline-model:cancel", (_event, operationId: unknown) => {
  if (typeof operationId !== "string" || operationId.length > 128) {
    return { ok: false, error: "Invalid offline model download." };
  }
  const entry = runningOfflineModelDownloads.get(operationId);
  if (!entry) {
    return {
      ok: false,
      error: "That offline model download is no longer running.",
    };
  }
  entry.controller.abort();
  return { ok: true };
});

ipcMain.handle("offline-model:remove", async () => {
  try {
    if (runningOfflineModelDownloads.size > 0) {
      throw new Error(
        "Wait for the offline model download to finish or cancel it first.",
      );
    }
    const previous = loadSettings();
    const usingDownloadedModel =
      previous.mode === "bundled" &&
      !packagedBundledModelAvailable() &&
      Boolean(llamaProcess) &&
      llamaModelAlias.startsWith("downloaded-");
    if (usingDownloadedModel) {
      await activateDesktopSettings(previous, { ...previous, mode: "offline" });
    }
    await removeOfflineModel(offlineModelRoot(), offlineModelSpec());
    const current = loadSettings();
    saveSettings(clearOfflineModelFailure(current));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
});

ipcMain.handle("settings:close", () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
});

ipcMain.handle("ui-language:get", () => loadSettings().uiLanguage);

ipcMain.handle("ui-language:set", (_event, language: unknown) => {
  const normalized =
    typeof language === "string" && /^[a-z]{2}$/i.test(language)
      ? language.toLowerCase()
      : DEFAULT_SETTINGS.uiLanguage;
  saveSettings({ ...loadSettings(), uiLanguage: normalized });
});

// App version + current auto-update status, read by the Settings window so it can
// show which version is installed and reflect download/ready progress live.
ipcMain.handle("app:info", () =>
  createAppInfo(app.getVersion(), app.isPackaged, updateStatusStore.get()),
);

// "Check for Updates" button in Settings — reuses the same flow as the menu item.
ipcMain.handle("update:check", () => {
  checkForUpdatesManually();
});

ipcMain.handle("update:install", async () => {
  try {
    await updateController.installDownloadedUpdate();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: UPDATE_INSTALL_FAILURE_MESSAGE };
  }
});

ipcMain.handle("update:release", async () => {
  try {
    await shell.openExternal(RELEASE_DOWNLOAD_URL);
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not open the release download page." };
  }
});

// ---------------------------------------------------------------------------
// Auto-update (electron-updater). The release feed + provider are baked into
// app-update.yml by electron-builder at package time (publish config in
// electron-builder.yml). On launch we silently check the feed; if a newer
// version exists it downloads in the background and we prompt the user to
// restart to apply it. A manual "Check for Updates…" menu item reuses the same
// flow but also reports "you're up to date" / errors.
//
// No-ops in dev/unpackaged runs (and when the feed metadata is absent), so it
// never interferes with `electron .` development.
// ---------------------------------------------------------------------------
function setupAutoUpdates(): void {
  if (packagedSmokeUpdateFeedUrl) {
    let feedUrl: URL;
    try {
      feedUrl = new URL(packagedSmokeUpdateFeedUrl);
    } catch {
      throw new Error("Packaged updater smoke feed URL is invalid.");
    }
    if (
      feedUrl.protocol !== "http:" ||
      feedUrl.hostname !== "127.0.0.1" ||
      !feedUrl.port
    ) {
      throw new Error(
        "Packaged updater smoke feed must be an HTTP loopback URL.",
      );
    }
    autoUpdater.forceDevUpdateConfig = true;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.setFeedURL({
      provider: "generic",
      url: feedUrl.toString(),
    });
    appendSmokeDiagnostic(
      "update.log",
      `phase=disposable-feed-configured url=${feedUrl.origin}/\n`,
    );
  }
  const updater =
    packagedSmokeUpdateEnabled && !packagedSmokeUpdateFeedUrl
      ? createPackagedSmokeUpdater()
      : autoUpdater;
  updateController = setupAutoUpdateFlow({
    isPackaged: app.isPackaged,
    updater,
    getMainWindow: () => mainWindow,
    showMessageBox: (window, options) => {
      if (packagedSmokeUpdateEnabled) {
        const response = options.buttons.includes("Later") ? 1 : 0;
        if (response === 1) {
          appendSmokeDiagnostic("update.log", "phase=deferred\n");
        }
        return Promise.resolve({ response });
      }
      return dialog.showMessageBox(window as BrowserWindow, options);
    },
    setStatus: setUpdateStatus,
    resetWindowTitle,
    stopDesktopWork: () =>
      stopDesktopWork({
        stopImports: cancelAllDesktopDownloads,
        stopServer,
        stopLlama,
      }),
    installDownloadedUpdate,
    markQuitting: () => {
      quitting = true;
    },
    deferInstallOnQuit: Boolean(packagedSmokeUpdateFeedUrl),
    logError: (message, error) => {
      console.error(message, error);
      if (packagedSmokeUpdateEnabled) {
        appendSmokeDiagnostic(
          "update.log",
          `phase=error ${message} ${String(error)}\n`,
        );
      }
    },
    ...(packagedSmokeUpdateEnabled
      ? { schedule: () => undefined }
      : {}),
  });
}

function checkForUpdatesManually(): void {
  updateController.checkForUpdatesManually();
}

// ---------------------------------------------------------------------------
// App lifecycle.
// ---------------------------------------------------------------------------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      await customGgufStore().cleanStalePartials();
      await startServer();
      if (packagedSmokeSimulatedFailure) {
        console.error(
          "[desktop] packaged upgrade rollback smoke: intentional startup failure",
        );
        app.quit();
        return;
      }
      createMainWindow();
      if (packagedSmokeEnabled) {
        // Headless Linux Electron does not dispatch the menu accelerator used
        // by the smoke test consistently. Open Settings through the same
        // production function after the dashboard has had time to mount.
        setTimeout(openSettingsWindow, 1500);
      }
      setupAutoUpdates();
    } catch (error) {
      dialog.showErrorBox(
        "ENGRAM failed to start",
        `The embedded server could not start.\n\n${String(error)}`,
      );
      app.quit();
    }

    app.on("activate", () => {
      if (mainWindow === null && currentPort) createMainWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on(
    "before-quit",
    createBeforeQuitHandler({
      hasWork: () =>
        Boolean(serverProcess || llamaProcess || hasRunningModelOperation()),
      isQuitting: () => quitting,
      markQuitting: () => {
        quitting = true;
      },
      stopDesktopWork: () =>
        stopDesktopWork({
          stopImports: cancelAllDesktopDownloads,
          stopServer,
          stopLlama,
        }),
      quit: () => app.quit(),
    }),
  );
}
