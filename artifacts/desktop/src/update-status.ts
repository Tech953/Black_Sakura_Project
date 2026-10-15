import type { AppInfo, UpdateStatus } from "./desktop-bridge";

export type UpdateStatusListener = (status: UpdateStatus) => void;

export function createUpdateStatusStore(
  notify: UpdateStatusListener,
  initial: UpdateStatus = { state: "idle" },
): {
  get: () => UpdateStatus;
  set: (status: UpdateStatus) => void;
} {
  let current: UpdateStatus = initial;

  return {
    get: () => current,
    set: (status) => {
      current = status;
      notify(status);
    },
  };
}

export function createAppInfo(
  version: string,
  updatesSupported: boolean,
  updateStatus: UpdateStatus,
): AppInfo {
  return { version, updatesSupported, updateStatus };
}
