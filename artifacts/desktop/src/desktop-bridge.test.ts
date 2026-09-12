import { describe, expect, it, vi } from "vitest";
import {
  createEngramDesktopBridge,
  type AppInfo,
  type RendererIpc,
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
      "downloadOfflineModel",
      "getAppInfo",
      "getSettings",
      "importGguf",
      "onGgufImportStatus",
      "onOfflineModelStatus",
      "onUpdateStatus",
      "removeGguf",
      "removeOfflineModel",
      "renameGguf",
      "saveSettings",
    ]);
  });

  it("selects natively and imports by opaque id without a renderer path API", async () => {
    const { ipc, invoke } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);

    await bridge.chooseGguf();
    await bridge.importGguf("opaque-selection");

    expect(invoke).toHaveBeenNthCalledWith(1, "gguf:choose");
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "gguf:import",
      "opaque-selection",
    );
    expect(Object.keys(bridge).some((key) => /path|file/i.test(key))).toBe(
      false,
    );
  });

  it("removes progress listeners with the same allowlisted channel", () => {
    const { ipc, listeners } = fakeIpc();
    const bridge = createEngramDesktopBridge(ipc);
    const unsubscribe = bridge.onGgufImportStatus(vi.fn());
    expect(listeners.has("gguf:import-status")).toBe(true);
    unsubscribe();
    expect(listeners.has("gguf:import-status")).toBe(false);
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

    await expect(bridge.getAppInfo()).resolves.toEqual(appInfo);
    expect(invoke).toHaveBeenCalledWith("app:info");
  });
});
