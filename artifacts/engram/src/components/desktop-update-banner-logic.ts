export type DesktopUpdateStatus =
  | { state: "idle" }
  | { state: "checking"; manual?: boolean }
  | { state: "available"; version?: string }
  | { state: "not-available"; manual?: boolean }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version?: string }
  | { state: "error"; message: string };

export function clampProgress(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}

export function statusText(status: DesktopUpdateStatus): string {
  switch (status.state) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return status.version
        ? `Update ${status.version} available — downloading…`
        : "Update available — downloading…";
    case "downloading":
      return `Downloading update… ${clampProgress(status.percent)}%`;
    case "downloaded":
      return status.version
        ? `Update ${status.version} ready to install`
        : "Update ready to install";
    case "not-available":
      return "ENGRAM is up to date";
    case "error":
      return "Update check failed";
    default:
      return "";
  }
}
