import { describe, expect, it, vi } from "vitest";
import {
  setupAutoUpdates,
  type AutoUpdaterLike,
  type UpdateDialogOptions,
  type UpdateWindow,
} from "./auto-update";

class FakeUpdater {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  readonly checkForUpdates = vi.fn().mockResolvedValue(undefined);
  readonly quitAndInstall = vi.fn();
  private readonly listeners = new Map<string, (...args: unknown[]) => void>();

  on(event: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(event, listener);
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args);
  }
}

function createHarness(response: number) {
  const updater = new FakeUpdater();
  const window: UpdateWindow = {
    isDestroyed: () => false,
    setTitle: vi.fn(),
    setProgressBar: vi.fn(),
  };
  const dialogs: UpdateDialogOptions[] = [];
  const showMessageBox = vi.fn(
    async (_window: UpdateWindow, options: UpdateDialogOptions) => {
      dialogs.push(options);
      return { response };
    },
  );
  const stopDesktopWork = vi.fn().mockResolvedValue(undefined);
  const installDownloadedUpdate = vi.fn().mockResolvedValue(undefined);
  const setStatus = vi.fn();
  const controller = setupAutoUpdates({
    isPackaged: true,
    updater: updater as unknown as AutoUpdaterLike,
    getMainWindow: () => window,
    showMessageBox,
    setStatus,
    resetWindowTitle: vi.fn(),
    stopDesktopWork,
    installDownloadedUpdate,
    markQuitting: vi.fn(),
    schedule: vi.fn(),
  });

  return {
    updater,
    controller,
    dialogs,
    showMessageBox,
    stopDesktopWork,
    installDownloadedUpdate,
    setStatus,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("setupAutoUpdates", () => {
  it("routes Restart now through the DB-safe installer", async () => {
    const harness = createHarness(0);

    harness.updater.emit("update-downloaded", { version: "1.2.3" });
    await flushPromises();

    expect(harness.dialogs[0]).toMatchObject({
      title: "Update ready",
      buttons: ["Restart now", "Later"],
    });
    expect(harness.installDownloadedUpdate).toHaveBeenCalledTimes(1);
    expect(harness.stopDesktopWork).not.toHaveBeenCalled();

    const installDeps = harness.installDownloadedUpdate.mock.calls[0]?.[0];
    expect(installDeps).toBeDefined();
    await installDeps?.stopServer();
    expect(harness.stopDesktopWork).toHaveBeenCalledTimes(1);
  });

  it("defers Later without stopping the server", async () => {
    const harness = createHarness(1);

    harness.updater.emit("update-downloaded", { version: "1.2.3" });
    await flushPromises();

    expect(harness.updater.autoInstallOnAppQuit).toBe(true);
    expect(harness.installDownloadedUpdate).not.toHaveBeenCalled();
    expect(harness.stopDesktopWork).not.toHaveBeenCalled();
  });

  it("exposes the ready update installer to the renderer and deduplicates calls", async () => {
    const harness = createHarness(1);

    harness.updater.emit("update-downloaded", { version: "1.2.3" });
    await flushPromises();
    await Promise.all([
      harness.controller.installDownloadedUpdate(),
      harness.controller.installDownloadedUpdate(),
    ]);

    expect(harness.installDownloadedUpdate).toHaveBeenCalledTimes(1);
  });

  it("shows up-to-date and error dialogs only for manual checks", async () => {
    const harness = createHarness(0);

    harness.updater.emit("update-not-available", {});
    expect(harness.showMessageBox).not.toHaveBeenCalled();

    harness.controller.checkForUpdatesManually();
    harness.updater.emit("update-not-available", {});
    expect(harness.dialogs.at(-1)).toMatchObject({
      title: "You're up to date",
    });

    harness.showMessageBox.mockClear();
    harness.controller.checkForUpdatesManually();
    harness.updater.emit("error", new Error("feed unavailable"));
    expect(harness.showMessageBox).toHaveBeenCalledTimes(1);
    expect(harness.dialogs.at(-1)).toMatchObject({
      title: "Update check failed",
    });

    harness.showMessageBox.mockClear();
    harness.updater.emit("error", new Error("silent feed unavailable"));
    expect(harness.showMessageBox).not.toHaveBeenCalled();
  });
});
