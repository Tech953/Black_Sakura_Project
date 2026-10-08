import type { UpdateStatus } from "./desktop-bridge";

export const UPDATE_CHECK_FAILURE_MESSAGE = "Could not check for updates.";
export const UPDATE_INSTALL_FAILURE_MESSAGE =
  "The downloaded update could not be installed.";
export const DEFERRED_UPDATE_FAILURE_MESSAGE =
  "The downloaded update could not be installed. Try again or download the latest release.";

export type UpdateInfo = { version?: string };
export type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export type UpdateWindow = {
  isDestroyed: () => boolean;
  setTitle: (title: string) => void;
  setProgressBar: (progress: number) => void;
};

export type UpdateDialogOptions = {
  type: "info" | "error";
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId?: number;
  cancelId?: number;
};

export interface AutoUpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "checking-for-update", listener: () => void): void;
  on(event: "update-available", listener: (info: UpdateInfo) => void): void;
  on(event: "update-not-available", listener: (info: UpdateInfo) => void): void;
  on(
    event: "download-progress",
    listener: (progress: DownloadProgress) => void,
  ): void;
  on(event: "error", listener: (error: unknown) => void): void;
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): void;
  checkForUpdates: () => Promise<unknown>;
  quitAndInstall: () => void;
}

type InstallDownloadedUpdate = (deps: {
  stopServer: () => Promise<void>;
  quitAndInstall: () => void;
  setAutoInstallOnAppQuit: (value: boolean) => void;
  markQuitting: () => void;
}) => Promise<void>;

export type AutoUpdateDeps = {
  isPackaged: boolean;
  updater: AutoUpdaterLike;
  getMainWindow: () => UpdateWindow | null;
  showMessageBox: (
    window: UpdateWindow | null,
    options: UpdateDialogOptions,
  ) => Promise<{ response: number }>;
  setStatus: (status: UpdateStatus) => void;
  resetWindowTitle: () => void;
  stopDesktopWork: () => Promise<void>;
  installDownloadedUpdate: InstallDownloadedUpdate;
  markQuitting: () => void;
  deferInstallOnQuit?: boolean;
  logError?: (message: string, error: unknown) => void;
  schedule?: (callback: () => void, delayMs: number) => unknown;
};

export type AutoUpdateController = {
  checkForUpdatesManually: () => void;
  installDownloadedUpdate: () => Promise<void>;
};

export function setupAutoUpdates(deps: AutoUpdateDeps): AutoUpdateController {
  let manualUpdateCheck = false;
  let deferredInstall = false;
  let downloadedUpdate: UpdateInfo | null = null;
  let installPromise: Promise<void> | null = null;
  let installAttemptInFlight = false;
  let resetInstallPromiseAfterAttempt = false;
  const schedule =
    deps.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const checkForUpdatesManually = (): void => {
    if (!deps.isPackaged) {
      const window = deps.getMainWindow();
      if (window && !window.isDestroyed()) {
        void deps.showMessageBox(window, {
          type: "info",
          title: "Updates unavailable",
          message: "Automatic updates only run in the packaged app.",
          buttons: ["OK"],
        });
      }
      return;
    }
    manualUpdateCheck = true;
    deferredInstall = false;
    deps.setStatus({ state: "checking", manual: true });
    void deps.updater.checkForUpdates().catch((error) => {
      deps.setStatus({
        state: "error",
        message: UPDATE_CHECK_FAILURE_MESSAGE,
      });
      deps.logError?.("[desktop] manual update check failed:", error);
      manualUpdateCheck = false;
    });
  };

  const createInstallFailureStatus = (info: UpdateInfo): UpdateStatus => ({
    state: "error",
    message: DEFERRED_UPDATE_FAILURE_MESSAGE,
    retryable: true,
    updateReady: true,
    ...(deferredInstall ? { deferred: true } : {}),
    ...(info.version === undefined ? {} : { version: info.version }),
  });

  const installReadyUpdate = (): Promise<void> => {
    if (!deps.isPackaged) {
      return Promise.reject(
        new Error("Automatic updates only run in the packaged app."),
      );
    }
    if (!downloadedUpdate) {
      return Promise.reject(
        new Error("No downloaded update is ready to install."),
      );
    }
    if (!installPromise) {
      installAttemptInFlight = true;
      installPromise = Promise.resolve()
        .then(() =>
          deps.installDownloadedUpdate({
            stopServer: deps.stopDesktopWork,
            quitAndInstall: () => deps.updater.quitAndInstall(),
            setAutoInstallOnAppQuit: (value) => {
              deps.updater.autoInstallOnAppQuit = value;
            },
            markQuitting: deps.markQuitting,
          }),
        )
        .then(() => {
          installAttemptInFlight = false;
          if (resetInstallPromiseAfterAttempt) {
            resetInstallPromiseAfterAttempt = false;
            installPromise = null;
          }
        })
        .catch((error) => {
          installAttemptInFlight = false;
          resetInstallPromiseAfterAttempt = false;
          installPromise = null;
          if (downloadedUpdate) {
            deps.setStatus(createInstallFailureStatus(downloadedUpdate));
          }
          throw error;
        });
    }
    return installPromise;
  };

  if (!deps.isPackaged) {
    return {
      checkForUpdatesManually,
      installDownloadedUpdate: installReadyUpdate,
    };
  }

  deps.updater.autoDownload = true;
  deps.updater.autoInstallOnAppQuit = false;

  deps.updater.on("checking-for-update", () => {
    deps.setStatus({ state: "checking", manual: manualUpdateCheck });
  });

  deps.updater.on("update-available", (info) => {
    deps.setStatus({ state: "available", version: info?.version });
    const window = deps.getMainWindow();
    if (manualUpdateCheck && window && !window.isDestroyed()) {
      void deps.showMessageBox(window, {
        type: "info",
        title: "Update available",
        message: "A new version of ENGRAM is available.",
        detail:
          "It is downloading now and you'll be prompted to restart when it's ready.",
        buttons: ["OK"],
      });
    }
  });

  deps.updater.on("update-not-available", () => {
    deps.setStatus({
      state: "not-available",
      manual: manualUpdateCheck,
    });
    const window = deps.getMainWindow();
    if (manualUpdateCheck && window && !window.isDestroyed()) {
      void deps.showMessageBox(window, {
        type: "info",
        title: "You're up to date",
        message: "ENGRAM is already running the latest version.",
        buttons: ["OK"],
      });
    }
    manualUpdateCheck = false;
  });

  deps.updater.on("download-progress", (progress) => {
    const percent = Math.max(
      0,
      Math.min(100, Math.round(progress?.percent ?? 0)),
    );
    const status: UpdateStatus = {
      state: "downloading",
      percent,
    };
    if (typeof progress?.transferred === "number") {
      status.transferred = progress.transferred;
    }
    if (typeof progress?.total === "number") {
      status.total = progress.total;
    }
    if (typeof progress?.bytesPerSecond === "number") {
      status.bytesPerSecond = progress.bytesPerSecond;
    }
    deps.setStatus(status);
    const window = deps.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.setTitle(`ENGRAM — PYRI — Downloading update… ${percent}%`);
      window.setProgressBar(percent / 100);
    }
  });

  deps.updater.on("error", (error) => {
    if (downloadedUpdate) {
      if (installAttemptInFlight) {
        resetInstallPromiseAfterAttempt = true;
      } else {
        installPromise = null;
      }
      deps.setStatus(createInstallFailureStatus(downloadedUpdate));
    } else {
      deps.setStatus({ state: "error", message: UPDATE_CHECK_FAILURE_MESSAGE });
    }
    deps.resetWindowTitle();
    const window = deps.getMainWindow();
    if (window && !window.isDestroyed()) window.setProgressBar(-1);
    deps.logError?.("[desktop] auto-update error:", error);
    if (manualUpdateCheck && window && !window.isDestroyed()) {
      void deps.showMessageBox(window, {
        type: "error",
        title: "Update check failed",
        message: "Could not check for updates.",
        detail: UPDATE_CHECK_FAILURE_MESSAGE,
        buttons: ["OK"],
      });
    }
    manualUpdateCheck = false;
  });

  deps.updater.on("update-downloaded", (info) => {
    downloadedUpdate = info;
    deferredInstall = false;
    installPromise = null;
    manualUpdateCheck = false;
    deps.resetWindowTitle();
    const window = deps.getMainWindow();
    const rendererAvailable = Boolean(window && !window.isDestroyed());
    if (rendererAvailable && window) window.setProgressBar(-1);

    // The in-app banner owns the ready decision whenever its renderer is
    // available. Default to install-on-quit so dismissing that banner as
    // "Later" keeps the previous native-dialog behavior without extra IPC.
    if (!deps.deferInstallOnQuit) {
      deferredInstall = true;
      deps.updater.autoInstallOnAppQuit = true;
    }

    if (rendererAvailable) {
      deps.setStatus({ state: "downloaded", version: info?.version });
      return;
    }

    // There is no renderer to show the banner, so use the native dialog as a
    // fallback. Do not publish "downloaded" until it closes; otherwise a
    // window created while the dialog is open could show a second decision.
    void deps
      .showMessageBox(null, {
        type: "info",
        title: "Update ready",
        message: `ENGRAM ${info.version} has been downloaded.`,
        detail:
          "Restart now to apply the update, or keep working and it'll install the next time you quit.",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          void installReadyUpdate().catch((error) => {
            deps.logError?.("[desktop] update installation failed:", error);
          });
        } else {
          deps.setStatus({ state: "downloaded", version: info?.version });
        }
      })
      .catch((error) => {
        deps.logError?.("[desktop] update ready dialog failed:", error);
        deps.setStatus({ state: "downloaded", version: info?.version });
      });
  });

  schedule(() => {
    void deps.updater.checkForUpdates().catch((error) => {
      deps.logError?.("[desktop] initial update check failed:", error);
    });
  }, 5000);

  return {
    checkForUpdatesManually,
    installDownloadedUpdate: installReadyUpdate,
  };
}
