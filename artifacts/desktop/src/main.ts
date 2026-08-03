import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  safeStorage,
  shell,
  dialog,
} from "electron";
import { autoUpdater } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { stopProcess, installDownloadedUpdate } from "./lifecycle";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";

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

function bundledModelAvailable(): boolean {
  return existsSync(llamaBin) && existsSync(llamaModel);
}

let serverProcess: ChildProcess | null = null;
let llamaProcess: ChildProcess | null = null;
let llamaPort = 0;
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
  mode: "bundled" | "offline" | "online";
  /** Listen on all interfaces so the mobile app can connect over LAN. */
  allowLan?: boolean;
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

const DEFAULT_SETTINGS: Settings = {
  // "bundled" uses the built-in llama.cpp server + model shipped with the app
  // (fully offline, zero setup). Falls back to "offline" (external local
  // server) at runtime if the bundled files are missing from this build.
  mode: "bundled",
  offline: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
  online: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

function normalizeMode(mode: unknown): Settings["mode"] {
  if (mode === "online") return "online";
  if (mode === "offline") return "offline";
  return "bundled";
}

/** The mode actually used at runtime: bundled degrades to offline when this
 * build ships no model (e.g. a dev run without staged resources). */
function effectiveMode(settings: Settings): Settings["mode"] {
  if (settings.mode === "bundled" && !bundledModelAvailable()) return "offline";
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
      mode: normalizeMode(parsed.mode),
      allowLan: parsed.allowLan === true,
      offline: { ...DEFAULT_SETTINGS.offline, ...(parsed.offline ?? {}) },
      online: { ...DEFAULT_SETTINGS.online, ...(parsed.online ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

function saveSettings(settings: Settings): void {
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify(settings, null, 2), "utf8");
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
    mode === "bundled" && llamaProcess && llamaPort > 0
      ? { baseUrl: `http://127.0.0.1:${llamaPort}/v1`, model: "bundled" }
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
        reject(new Error("Bundled model server did not become ready in time."));
      } else {
        setTimeout(attempt, 1000);
      }
    };
    attempt();
  });
}

async function startLlama(): Promise<void> {
  llamaPort = await findFreePort();
  const proc = spawn(
    llamaBin,
    [
      "-m",
      llamaModel,
      "--host",
      "127.0.0.1",
      "--port",
      String(llamaPort),
      "-c",
      "8192",
      "--no-webui",
    ],
    {
      // cwd = bin dir so the llama.cpp shared libraries/DLLs next to the
      // executable resolve on every platform.
      cwd: path.dirname(llamaBin),
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
      if (llamaProcess === proc) llamaProcess = null;
      if (!settled) {
        settled = true;
        reject(new Error(`Bundled model server failed to start: ${err.message}`));
      }
    });
    proc.on("exit", (code, signal) => {
      if (llamaProcess === proc) llamaProcess = null;
      if (!settled) {
        settled = true;
        reject(
          new Error(
            `Bundled model server exited before becoming ready (code=${code}, signal=${signal}).`,
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
  return stopProcess(proc);
}

async function startServer(): Promise<void> {
  if (!existsSync(serverEntry)) {
    throw new Error(
      `Server bundle not found at ${serverEntry}. Run the desktop build (pnpm --filter @workspace/desktop run build) first.`,
    );
  }
  const settings = loadSettings();
  mkdirSync(userDataPath("db"), { recursive: true });
  // Bundled mode: bring up the built-in model server first so its port is
  // known when the api-server env is built. A llama startup failure never
  // blocks the app — buildServerEnv degrades to the external local-server
  // settings when no llama process is live, so the UI still opens and the
  // user can pick another mode.
  if (effectiveMode(settings) === "bundled" && !llamaProcess) {
    try {
      await startLlama();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[desktop] bundled model unavailable, falling back:", err);
    }
  }
  currentPort = await findFreePort();
  const env = buildServerEnv(settings, currentPort);

  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProcess.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(`[server] ${chunk.toString()}`);
  });
  serverProcess.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[server] ${chunk.toString()}`);
  });
  serverProcess.on("exit", (code, signal) => {
    if (!quitting) {
      // eslint-disable-next-line no-console
      console.error(
        `[desktop] server process exited unexpectedly (code=${code}, signal=${signal}).`,
      );
    }
    serverProcess = null;
  });

  await waitForHealth(currentPort);
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

async function restartServer(): Promise<void> {
  await stopServer();
  // Stop the bundled model server too so a mode switch away from "bundled"
  // releases its memory; startServer re-spawns it when still needed.
  await stopLlama();
  await startServer();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(`http://127.0.0.1:${currentPort}/`);
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

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 560,
    height: 640,
    resizable: false,
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
ipcMain.handle("settings:get", () => {
  const settings = loadSettings();
  return {
    mode: settings.mode,
    bundledAvailable: bundledModelAvailable(),
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
  };
});

ipcMain.handle(
  "settings:save",
  async (_event, payload: {
    mode: "bundled" | "offline" | "online";
    allowLan?: boolean;
    offline: { baseUrl: string; model: string };
    online: { baseUrl: string; model: string; apiKey: string };
  }) => {
    try {
      const previous = loadSettings();
      const next: Settings = {
        mode: normalizeMode(payload.mode),
        allowLan: payload.allowLan === true,
        offline: {
          baseUrl: payload.offline.baseUrl.trim() || DEFAULT_SETTINGS.offline.baseUrl,
          model: payload.offline.model.trim() || DEFAULT_SETTINGS.offline.model,
        },
        online: {
          baseUrl: payload.online.baseUrl.trim() || DEFAULT_SETTINGS.online.baseUrl,
          model: payload.online.model.trim() || DEFAULT_SETTINGS.online.model,
          apiKeyEnc: previous.online.apiKeyEnc,
        },
      };

      const newKey = payload.online.apiKey;
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

      saveSettings(next);
      await restartServer();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.close();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  },
);

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
            stopServer: async () => {
              await stopServer();
              await stopLlama();
            },
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
      await startServer();
      createMainWindow();
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
    if ((serverProcess || llamaProcess) && !quitting) {
      event.preventDefault();
      quitting = true;
      void stopServer()
        .then(() => stopLlama())
        .finally(() => app.quit());
    }
  });
}
