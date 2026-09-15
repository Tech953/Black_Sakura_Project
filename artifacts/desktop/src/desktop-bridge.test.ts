import { describe, expect, it, vi } from "vitest";
import {
  createEngramDesktopBridge,
  type AppInfo,
  type RendererIpc,
  type UpdateStatus,
} from "./desktop-bridge";

function fakeIpc() {
  const listeners = new Map<
    string,
    (event: unknown, payload: unknown) => void
  >();
  const invoke = vi.fn(
    async (..._args: unknown[]): Promise<unknown> => ({ ok: true }),
  );
  const ipc: RendererIpc = {
    invoke,
    on: (channel, listener) => listeners.set(channel, listener),
    removeListener: (channel, listener) => {
      if (listeners.get(channel) === listener) listeners.delete(channel);
    },
  };
  return { ipc, invoke, listeners };
}

describe("desktop renderer bridge", () => {
  it("exposes only allowlisted high-level operations", () => {
    const { ipc } = fakeIpc();
    expect(Object.keys(createEngramDesktopBridge(ipc)).sort()).toEqual([
      "activateGguf",
      "cancelGgufImport",
      "cancelOfflineModelDownload",
      "checkForUpdates",
      "chooseGguf",
      "close",
      "copyText",
      "downloadOfflineModel",
      "getAppInfo",
      "getSettings",
      "getUiLanguage",
      "importGguf",
      "installDownloadedUpdate",
      "onGgufImportStatus",
      "onOfflineModelStatus",
      "onUpdateStatus",
      "openReleaseDownloadPage",
      "removeGguf",
      "removeOfflineModel",
      "renameGguf",
      "saveSettings",
      "setUiLanguage",
    ]);
  });

  it("copies text through the narrow clipboard bridge", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.copyText("http://127.0.0.1:4312");

    expect(invoke).toHaveBeenCalledWith(
      "clipboard:write",
      "http://127.0.0.1:4312",
    );
  });

  it("selects natively and imports by opaque id without a renderer path API", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.openReleaseDownloadPage();

    expect(invoke).toHaveBeenCalledWith("update:release");
  });

  it("forwards live update status and unsubscribes cleanly", () => {
    const { ipc, listeners } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);
    const onStatus = vi.fn();
    const unsubscribe = bridge.onUpdateStatus(onStatus);
    expect(listeners.has("update:status")).toBe(true);
    unsubscribe();
    expect(listeners.has("update:status")).toBe(false);
  });

  it("forwards the app info contract without reshaping its update status", async () => {
    const { ipc, invoke } = fakeIpc();
    const appInfo: AppInfo = {
      version: "1.2.3",
      updatesSupported: true,
      updateStatus: { state: "downloading", percent: 42 },
    };
    invoke.mockResolvedValueOnce(appInfo);

    const bridge = createEngramDesktopBridge(ipc);

    await bridge.installDownloadedUpdate();

    expect(invoke).toHaveBeenCalledWith("update:install");
  });

  it("opens the fixed release page through the main-process bridge", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.installDownloadedUpdate();

    expect(invoke).toHaveBeenCalledWith("update:install");
  });

  it("opens the fixed release page through the main-process bridge", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.installDownloadedUpdate();

    expect(invoke).toHaveBeenCalledWith("update:install");
  });

  it("opens the fixed release page through the main-process bridge", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.openReleaseDownloadPage();

    expect(invoke).toHaveBeenCalledWith("update:release");
  });

  it("forwards live update status and unsubscribes cleanly", () => {
    const { ipc, listeners } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);
    const onStatus = vi.fn();
    const emit = (payload: UpdateStatus) => {
      listeners.get("update:status")?.({}, payload);
    };
    const status: UpdateStatus = {
      state: "downloading",
      percent: 42,
      transferred: 1572864,
      total: 5242880,
      bytesPerSecond: 262144,
    };

    const unsubscribe = bridge.onUpdateStatus(onStatus);
    emit(status);

    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith(status);

    unsubscribe();
    expect(listeners.has("update:status")).toBe(false);

    emit({ state: "downloaded", version: "1.2.4" });
    expect(onStatus).toHaveBeenCalledTimes(1);
  });
});
