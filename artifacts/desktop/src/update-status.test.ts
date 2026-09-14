import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "./desktop-bridge";
import { createAppInfo, createUpdateStatusStore } from "./update-status";

describe("desktop update status contract", () => {
  it("stores and broadcasts every updater state without reshaping it", () => {
    const notify = vi.fn();
    const store = createUpdateStatusStore(notify);
    const statuses: UpdateStatus[] = [
      { state: "checking", manual: true },
      { state: "available", version: "1.2.3" },
      { state: "downloading", percent: 42 },
      { state: "downloaded", version: "1.2.3" },
      { state: "not-available", manual: true },
      { state: "error", message: "network unavailable" },
    ];

    for (const status of statuses) {
      store.set(status);
      expect(store.get()).toEqual(status);
      expect(notify).toHaveBeenLastCalledWith(status);
    }

    expect(notify).toHaveBeenCalledTimes(statuses.length);
  });

  it("builds the complete app:info payload used by the IPC handler", () => {
    const updateStatus: UpdateStatus = {
      state: "downloading",
      percent: 42,
    };

    expect(createAppInfo("1.2.3", true, updateStatus)).toEqual({
      version: "1.2.3",
      updatesSupported: true,
      updateStatus,
    });
  });

  it("hydrates the status store with a persisted recovery state", () => {
    const initial: UpdateStatus = {
      state: "error",
      message: "The downloaded update could not be installed.",
      deferred: true,
      retryable: true,
    };
    const store = createUpdateStatusStore(vi.fn(), initial);

    expect(store.get()).toEqual(initial);
  });
});
