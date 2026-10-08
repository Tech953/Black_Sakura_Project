export type DesktopUpdateStatus =
  | { state: "idle" }
  | { state: "checking"; manual?: boolean }
  | { state: "available"; version?: string }
  | { state: "not-available"; manual?: boolean }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version?: string }
  | {
      state: "error";
      message: string;
      deferred?: boolean;
      retryable?: boolean;
      updateReady?: boolean;
      version?: string;
    };

export type DesktopUpdateCopy = {
  checking: string;
  availableWithVersion: string;
  available: string;
  downloading: string;
  downloaded: string;
  error: string;
  upToDate: string;
};

export function clampProgress(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function isRetryableInstallFailure(
  status: DesktopUpdateStatus,
): boolean {
  return (
    status.state === "error" &&
    status.retryable === true &&
    status.updateReady === true
  );
}

export function statusText(
  status: DesktopUpdateStatus,
  copy: DesktopUpdateCopy,
): string {
  switch (status.state) {
    case "checking":
      return copy.checking;
    case "available":
      return status.version
        ? copy.availableWithVersion.replace("{{version}}", status.version)
        : copy.available;
    case "downloading":
      return copy.downloading.replace(
        "{{percent}}",
        String(clampProgress(status.percent)),
      );
    case "downloaded":
      return copy.downloaded;
    case "not-available":
      return copy.upToDate;
    case "error":
      return isRetryableInstallFailure(status) ? copy.downloaded : copy.error;
    default:
      return "";
  }
}
