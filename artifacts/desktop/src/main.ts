import {
  app,
  BrowserWindow,
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
import { createServer } from "node:net";
import {
  stopProcess,
  installDownloadedUpdate,
  stopDesktopWork,
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
  normalizeCustomGgufMetadata,
  normalizeDesktopMode,
} from "./desktop-settings";
import {
  OFFLINE_MODEL,
  downloadOfflineModel,
  hasOfflineModelSync,
  offlineModelPartialPath,
  offlineModelPath,
  offlineModelStorageLocation,
  removeOfflineModel,
  verifyOfflineModel,
} from "./offline-model";
import type {
  CustomModelMetadataView,
  GgufImportStatus,
  OfflineModelDownloadStatus,
  OfflineModelView,
  SettingsPayload,
} from "./desktop-bridge";

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
// fallback. It lets the release check exercise the complete managed-GGUF
// import/selection/verification/start path with a tiny syntactically-valid
// fixture instead of distributing or downloading a real multi-GB model.
// Normal packaged builds fail closed: neither variable has any effect unless
// the app is running in GitHub Actions' CI environment.
const packagedSmokeEnabled =
  app.isPackaged &&
  process.env.CI === "true" &&
  process.env.GITHUB_ACTIONS === "true" &&
  process.env.ENGRAM_PACKAGED_GGUF_SMOKE === "1";
const packagedSmokeGguf = packagedSmokeEnabled
  ? process.env.ENGRAM_PACKAGED_GGUF_FIXTURE
  : undefined;

function bundledModelAvailable(): boolean {
  return (
    existsSync(llamaBin) &&
    (existsSync(llamaModel) || hasOfflineModelSync(offlineModelRoot()))
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
// True while a user-initiated "Check for Updates…" is in flight, so we surface
// the "you're up to date" / error dialogs only for manual checks (the silent
// startup check stays quiet unless an update is actually downloaded).
let manualUpdateCheck = false;

// Live auto-update status, mirrored to the Settings window so the user can see
// the installed version and whether an update is checking/downloading/ready.
type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version?: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version?: string }
  | { state: "error"; message: string };

let updateStatus: UpdateStatus = { state: "idle" };

function setUpdateStatus(status: UpdateStatus): void {
  updateStatus = status;
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("update:status", status);
  }
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
  /** Listen on all interfaces so the mobile app can connect over LAN. */
  allowLan?: boolean;
  custom?: CustomGgufMetadata;
  offline: { baseUrl: string; model: string };
  online: {
    baseUrl: string;
    model: string;
    apiKeyEnc?: string;
  };
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
  return (
    runningGgufImports.size > 0 || runningOfflineModelDownloads.size > 0
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeGgufError(error: unknown, sourcePath?: string): string {
  const message = errorMessage(error);
  return sourcePath ? message.split(sourcePath).join("[selected GGUF]") : message;
}

function customMetadataView(
  metadata: CustomGgufMetadata,
): CustomModelMetadataView {
  return {
    filename: metadata.originalFilename,
    byteSize: metadata.byteSize,
    sha256: metadata.sha256,
    ggufVersion: metadata.ggufVersion,
    importedAt: metadata.importedAt,
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
  offline: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
  online: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

function customGgufStore(): CustomGgufStore {
  customStoreInstance ??= new CustomGgufStore(
    userDataPath("models", "custom"),
  );
  return customStoreInstance;
}

async function preparePackagedSmokeCustomGguf(): Promise<void> {
  if (!packagedSmokeGguf) return;
  if (!path.isAbsolute(packagedSmokeGguf)) {
    throw new Error("Packaged GGUF smoke fixture must be an absolute path.");
  }
  // Use the same store import and persisted selection used by the IPC flow.
  // This is intentionally invoked only by the CI gate above.
  const imported = await customGgufStore().importModel(packagedSmokeGguf);
  const settings = loadSettings();
  saveSettings({ ...settings, mode: "custom", custom: imported });
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
    return {
      mode: normalizeDesktopMode(parsed.mode),
      allowLan: parsed.allowLan === true,
      custom: normalizeCustomGgufMetadata(parsed.custom),
      offline: { ...DEFAULT_SETTINGS.offline, ...(parsed.offline ?? {}) },
      online: { ...DEFAULT_SETTINGS.online, ...(parsed.online ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
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

function buildServerEnv(
  settings: Settings,
  port: number,
): NodeJS.ProcessEnv {
  const mode = effectiveMode(settings);
  const active =
    (mode === "bundled" || mode === "custom") &&
    llamaProcess &&
    llamaPort > 0
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
      const port =
        address && typeof address === "object" ? address.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

function waitForHealth(port: number, timeoutMs = 60000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = (): void => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/api/healthz", timeout: 2000 },
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
        reject(new Error("Embedded server did not become healthy in time."));
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
    const verifiedDownloaded = await verifyOfflineModel(offlineModelRoot());
    modelPath = verifiedDownloaded.path;
    llamaModelAlias = `downloaded-${OFFLINE_MODEL.sha256.slice(0, 12)}`;
  }
  llamaPort = await findFreePort();
  if (packagedSmokeEnabled) {
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
    const proc = spawn(process.execPath, ["-e", fixtureRuntime, String(llamaPort)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
  const proc = spawn(
    llamaBin,
    command.args,
    {
      // cwd = bin dir so the llama.cpp shared libraries/DLLs next to the
      // executable resolve on every platform.
      cwd: command.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  llamaProcess = proc;
  proc.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[llama] ${chunk.toString()}`);
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[llama] ${chunk.toString()}`);
  });
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
        reject(new Error(`Local model server failed to start: ${err.message}`));
      }
    });
    proc.on("exit", (code, signal) => {
      if (llamaProcess === proc) {
        llamaProcess = null;
        customRuntimeFingerprint = null;
      }
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Local model server exited before becoming ready (code=${code}, signal=${signal}).`,
          ),
        );
      } else if (!quitting) {
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
    throw err;
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
  if ((mode === "bundled" || mode === "custom") && !llamaProcess) {
    try {
      await startLlama(settings);
    } catch (err) {
      if (mode === "custom") customRuntimeError = errorMessage(err);
      // eslint-disable-next-line no-console
      console.error("[desktop] local model unavailable, falling back:", err);
      if (options.strictLocalModel) throw err;
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
    startupStderr = `${startupStderr}${chunk.toString()}`.slice(-12_000);
  };
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk.toString()}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    rememberStartupStderr(chunk);
    process.stderr.write(`[server] ${chunk.toString()}`);
  });
  const serverFailure = new Promise<never>((_, reject) => {
    serverProcess?.on("error", (error) => {
      if (startupSettled) return;
      startupSettled = true;
      reject(new Error(`Embedded server failed to start: ${error.message}`));
    });
    serverProcess?.on("exit", (code, signal) => {
      if (serverProcess) serverProcess = null;
      if (startupSettled) {
        if (!quitting) {
          // eslint-disable-next-line no-console
          console.error(
            `[desktop] server process exited unexpectedly (code=${code}, signal=${signal}).`,
          );
        }
        return;
      }
      startupSettled = true;
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
    await Promise.race([waitForHealth(currentPort), serverFailure]);
    startupSettled = true;
  } catch (error) {
    startupSettled = true;
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
  return stopProcess(proc);
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

async function getCustomModelView(settings: Settings) {
  const storageLocation = customGgufStore().root;
  if (!settings.custom) {
    return { storageLocation, status: "none" as const };
  }

  const metadata = customMetadataView(settings.custom);
  if (
    customRuntimeFingerprint === settings.custom.sha256 &&
    llamaProcess &&
    effectiveMode(settings) === "custom"
  ) {
    return { storageLocation, status: "active" as const, metadata };
  }

  try {
    await customGgufStore().verifyBeforeUse(settings.custom);
    if (customRuntimeError) {
      return {
        storageLocation,
        status: "error" as const,
        error: customRuntimeError,
        metadata,
      };
    }
    return { storageLocation, status: "available" as const, metadata };
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
    return {
      storageLocation,
      status: code === "ENOENT" ? ("missing" as const) : ("corrupt" as const),
      error: errorMessage(error),
      metadata,
    };
  }
}

async function getOfflineModelView(settings: Settings): Promise<OfflineModelView> {
  const root = offlineModelRoot();
  let downloadedBytes = 0;
  try {
    downloadedBytes = statSync(offlineModelPath(root)).size;
  } catch {
    try {
      downloadedBytes = statSync(offlineModelPartialPath(root)).size;
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
  try {
    if (hasOfflineModelSync(root)) {
      status = usingDownloadedModel ? "active" : "available";
    } else if (downloadedBytes > 0) {
      status = "partial";
      error = "A partial download is available and can be resumed.";
    }
  } catch (viewError) {
    status = "error";
    error = errorMessage(viewError);
  }
  return {
    filename: OFFLINE_MODEL.filename,
    expectedBytes: OFFLINE_MODEL.expectedBytes,
    expectedSha256: OFFLINE_MODEL.sha256,
    storageLocation: offlineModelStorageLocation(root),
    status,
    downloadedBytes,
    ...(error ? { error } : {}),
  };
}

async function runOfflineModelDownload(
  operationId: string,
  controller: AbortController,
): Promise<void> {
  let downloaded = false;
  try {
    const verified = await downloadOfflineModel(offlineModelRoot(), {
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
    await verifyOfflineModel(offlineModelRoot());

    sendOfflineModelStatus({ operationId, state: "activating" });
    const previous = loadSettings();
    await activateDesktopSettings(previous, { ...previous, mode: "bundled" });
    sendOfflineModelStatus({
      operationId,
      state: "completed",
      downloadedBytes: verified.size,
      totalBytes: OFFLINE_MODEL.expectedBytes,
    });
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    sendOfflineModelStatus({
      operationId,
      state: cancelled ? "cancelled" : "error",
      error: cancelled ? undefined : errorMessage(error),
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
    const candidate: Settings = {
      ...previous,
      mode: "custom",
      custom: imported,
    };

    try {
      await activateDesktopSettings(previous, candidate);
    } catch (error) {
      customRuntimeError = errorMessage(error);
      if (previous.mode !== "custom") {
        // Keep a validated first import discoverable for explicit retry/removal,
        // while the previous provider remains active.
        saveSettings({ ...previous, custom: imported });
      } else if (previous.custom?.sha256 !== imported.sha256) {
        // A failed replacement must leave the old active model authoritative.
        await customGgufStore().discard(imported).catch(() => undefined);
      }
      sendGgufImportStatus({
        operationId,
        state: "error",
        error: errorMessage(error),
        imported: previous.mode !== "custom",
      });
      return;
    }

    if (
      previous.custom &&
      previous.custom.sha256 !== imported.sha256
    ) {
      await customGgufStore().discard(previous.custom).catch((error) => {
        // The replacement is already active; cleanup can be retried manually.
        // eslint-disable-next-line no-console
        console.error("[desktop] old custom model cleanup failed:", error);
      });
    }
    sendGgufImportStatus({
      operationId,
      state: "completed",
      model: customMetadataView(imported),
    });
  } catch (error) {
    const cancelled =
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError");
    sendGgufImportStatus({
      operationId,
      state: cancelled ? "cancelled" : "error",
      error: cancelled
        ? undefined
        : safeGgufError(error, selection.sourcePath),
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
  return {
    mode: settings.mode,
    bundledAvailable: bundledModelAvailable(),
      bundledModelIncluded: packagedBundledModelAvailable(),
    allowLan: settings.allowLan === true,
    // LAN addresses the mobile app can use when LAN access is on.
    lanAddresses: Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => `http://${(i as os.NetworkInterfaceInfo).address}:${currentPort}`),
    offline: settings.offline,
    online: {
      baseUrl: settings.online.baseUrl,
      model: settings.online.model,
    },
    hasApiKey: Boolean(settings.online.apiKeyEnc) || Boolean(sessionApiKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    customModel: await getCustomModelView(settings),
      offlineModel: await getOfflineModelView(settings),
  };
});

ipcMain.handle(
  "settings:save",
  async (_event, payload: SettingsPayload) => {
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
      const previous = loadSettings();
      const next: Settings = {
        mode: normalizeDesktopMode(payload.mode),
        allowLan: payload.allowLan === true,
        custom: previous.custom,
        offline: {
          baseUrl:
            String(payload.offline.baseUrl ?? "").trim().slice(0, 2048) ||
            DEFAULT_SETTINGS.offline.baseUrl,
          model:
            String(payload.offline.model ?? "").trim().slice(0, 512) ||
            DEFAULT_SETTINGS.offline.model,
        },
        online: {
          baseUrl:
            String(payload.online.baseUrl ?? "").trim().slice(0, 2048) ||
            DEFAULT_SETTINGS.online.baseUrl,
          model:
            String(payload.online.model ?? "").trim().slice(0, 512) ||
            DEFAULT_SETTINGS.online.model,
          apiKeyEnc: previous.online.apiKeyEnc,
        },
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
      return { ok: false, error: String(error) };
    }
  },
);

ipcMain.handle("gguf:choose", async () => {
  let sourcePath: string | undefined;
  try {
    if (hasRunningModelOperation()) {
      throw new Error("A GGUF import is already running.");
    }
    for (const [id, selection] of pendingGgufSelections) {
      if (selection.expiresAt < Date.now()) pendingGgufSelections.delete(id);
    }
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
    if (
      typeof selectionId !== "string" ||
      selectionId.length > 128
    ) {
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
  if (!entry) return { ok: false, error: "That GGUF import is no longer running." };
  entry.controller.abort();
  return { ok: true };
});

ipcMain.handle("gguf:remove", async () => {
  try {
    if (hasRunningModelOperation()) {
      throw new Error("Wait for the GGUF import to finish or cancel it first.");
    }
    const previous = loadSettings();
    if (!previous.custom) return { ok: true };

    let deactivated = previous;
    if (previous.mode === "custom") {
      deactivated = {
        ...previous,
        mode: bundledModelAvailable() ? "bundled" : "offline",
      };
      await activateDesktopSettings(previous, deactivated);
    }

    try {
      await customGgufStore().discard(previous.custom);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      if (code !== "ENOENT") throw error;
    }
    saveSettings({ ...deactivated, custom: undefined });
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
    return { ok: false, error: "That offline model download is no longer running." };
  }
  entry.controller.abort();
  return { ok: true };
});

ipcMain.handle("offline-model:remove", async () => {
  try {
    if (runningOfflineModelDownloads.size > 0) {
      throw new Error("Wait for the offline model download to finish or cancel it first.");
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
    await removeOfflineModel(offlineModelRoot());
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

// App version + current auto-update status, read by the Settings window so it can
// show which version is installed and reflect download/ready progress live.
ipcMain.handle("app:info", () => ({
  version: app.getVersion(),
  updatesSupported: app.isPackaged,
  updateStatus,
}));

// "Check for Updates" button in Settings — reuses the same flow as the menu item.
ipcMain.handle("update:check", () => {
  checkForUpdatesManually();
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
  if (!app.isPackaged) return;

  // We drive the install ourselves via a restart prompt, so don't auto-install
  // on quit (would surprise the user). Downloads still happen automatically.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    setUpdateStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateStatus({ state: "available", version: info?.version });
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update available",
        message: "A new version of ENGRAM is available.",
        detail: "It is downloading now and you'll be prompted to restart when it's ready.",
        buttons: ["OK"],
      });
    }
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateStatus({ state: "not-available" });
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "You're up to date",
        message: "ENGRAM is already running the latest version.",
        buttons: ["OK"],
      });
    }
    manualUpdateCheck = false;
  });

  // Unobtrusive progress feedback while the installer downloads: mirror the
  // percentage to the Settings window and reflect it in the main window title
  // (and the macOS dock/taskbar progress bar). Cleared on completion and on
  // error so it never lingers.
  autoUpdater.on("download-progress", (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
    setUpdateStatus({ state: "downloading", percent });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`${WINDOW_TITLE} — Downloading update… ${percent}%`);
      mainWindow.setProgressBar(percent / 100);
    }
  });

  autoUpdater.on("error", (error) => {
    setUpdateStatus({ state: "error", message: String(error) });
    // Clear any in-progress download indicator so it doesn't linger on failure.
    resetWindowTitle();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
    // eslint-disable-next-line no-console
    console.error("[desktop] auto-update error:", error);
    if (manualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: String(error),
        buttons: ["OK"],
      });
    }
    manualUpdateCheck = false;
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateStatus({ state: "downloaded", version: info?.version });
    manualUpdateCheck = false;
    // Clear the progress indicator now that the download is complete; the
    // "Restart now / Later" prompt below takes over.
    resetWindowTitle();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.setProgressBar(-1);
    void dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Update ready",
        message: `ENGRAM ${info.version} has been downloaded.`,
        detail: "Restart now to apply the update, or keep working and it'll install the next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          // The server child holds the PGlite DB open, so it must shut down
          // cleanly BEFORE the installer swaps app files. installDownloadedUpdate
          // awaits stopServer() (shared SIGTERM→SIGKILL path) before quitAndInstall.
          void installDownloadedUpdate({
            // Stop BOTH children: the api-server (holds the PGlite DB open)
            // and the bundled llama-server (multi-GB resident process that
            // would otherwise survive the update swap as an orphan).
            stopServer: () =>
              stopDesktopWork({
                stopImports: cancelAllDesktopDownloads,
                stopServer,
                stopLlama,
              }),
            quitAndInstall: () => autoUpdater.quitAndInstall(),
            setAutoInstallOnAppQuit: (value) => {
              autoUpdater.autoInstallOnAppQuit = value;
            },
            markQuitting: () => {
              quitting = true;
            },
          });
        } else {
          // Honor the deferral: install silently on the next normal quit.
          autoUpdater.autoInstallOnAppQuit = true;
        }
      });
  });

  // Silent check shortly after startup so it never blocks the window opening.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error) => {
      // eslint-disable-next-line no-console
      console.error("[desktop] initial update check failed:", error);
    });
  }, 5000);
}

function checkForUpdatesManually(): void {
  if (!app.isPackaged) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      void dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Updates unavailable",
        message: "Automatic updates only run in the packaged app.",
        buttons: ["OK"],
      });
    }
    return;
  }
  manualUpdateCheck = true;
  setUpdateStatus({ state: "checking" });
  void autoUpdater.checkForUpdates().catch((error) => {
    setUpdateStatus({ state: "error", message: String(error) });
    // eslint-disable-next-line no-console
    console.error("[desktop] manual update check failed:", error);
    manualUpdateCheck = false;
  });
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
      await preparePackagedSmokeCustomGguf();
      await startServer();
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

  app.on("before-quit", (event) => {
    if (
      (serverProcess || llamaProcess || hasRunningModelOperation()) &&
      !quitting
    ) {
      event.preventDefault();
      quitting = true;
      void stopDesktopWork({
        stopImports: cancelAllDesktopDownloads,
        stopServer,
        stopLlama,
      })
        .finally(() => app.quit());
    }
  });
}
