import type { UpdateStatus } from "./desktop-bridge";

export const UPDATE_CHECK_FAILURE_MESSAGE = "Could not check for updates.";
export const UPDATE_INSTALL_FAILURE_MESSAGE = "Update could not be installed.";
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
    window: UpdateWindow,
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
      installPromise = deps
        .installDownloadedUpdate({
          stopServer: deps.stopDesktopWork,
          quitAndInstall: () => deps.updater.quitAndInstall(),
          setAutoInstallOnAppQuit: (value) => {
            deps.updater.autoInstallOnAppQuit = value;
          },
          markQuitting: deps.markQuitting,
        })
        .catch((error) => {
          installPromise = null;
          if (deferredInstall) {
            deps.setStatus({
              state: "error",
              message: DEFERRED_UPDATE_FAILURE_MESSAGE,
              deferred: true,
              retryable: true,
            });
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
    const deferredFailure = deferredInstall && downloadedUpdate !== null;
    deps.setStatus(
      deferredFailure
        ? {
            state: "error",
            message: DEFERRED_UPDATE_FAILURE_MESSAGE,
            deferred: true,
            retryable: true,
          }
        : { state: "error", message: UPDATE_CHECK_FAILURE_MESSAGE },
    );
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
    deps.setStatus({ state: "downloaded", version: info?.version });
    manualUpdateCheck = false;
    deps.resetWindowTitle();
    const window = deps.getMainWindow();
    if (!window || window.isDestroyed()) return;
    window.setProgressBar(-1);
    void deps
      .showMessageBox(window, {
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
          if (!deps.deferInstallOnQuit) {
            deferredInstall = true;
            deps.updater.autoInstallOnAppQuit = true;
          }
        }
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
