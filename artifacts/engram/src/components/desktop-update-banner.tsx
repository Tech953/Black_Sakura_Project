import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  X,
} from "lucide-react";

type DesktopUpdateStatus =
  | { state: "idle" }
  | { state: "checking"; manual?: boolean }
  | { state: "available"; version?: string }
  | { state: "not-available"; manual?: boolean }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version?: string }
  | { state: "error"; message: string };

type DesktopBridge = {
  getAppInfo: () => Promise<{ updateStatus: DesktopUpdateStatus }>;
  onUpdateStatus: (
    callback: (status: DesktopUpdateStatus) => void,
  ) => () => void;
};

function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { engram?: DesktopBridge }).engram;
}

function statusText(status: DesktopUpdateStatus): string {
  switch (status.state) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return status.version
        ? `Update ${status.version} available — downloading…`
        : "Update available — downloading…";
    case "downloading":
      return `Downloading update… ${status.percent}%`;
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

export default function DesktopUpdateBanner() {
  const [status, setStatus] = useState<DesktopUpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const previousState = useRef<DesktopUpdateStatus["state"]>("idle");

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;

    let mounted = true;
    const unsubscribe = bridge.onUpdateStatus((next) => {
      if (mounted) setStatus(next);
    });
    void bridge
      .getAppInfo()
      .then((info) => {
        if (mounted) setStatus(info.updateStatus);
      })
      .catch(() => {
        // The desktop bridge is best-effort; the web app remains fully usable.
      });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (previousState.current !== status.state && status.state !== "idle") {
      setDismissed(false);
    }
    previousState.current = status.state;
  }, [status.state]);

  const isManualCheck =
    (status.state === "checking" || status.state === "not-available") &&
    status.manual === true;
  const visible =
    !dismissed &&
    (status.state === "available" ||
      status.state === "downloading" ||
      status.state === "downloaded" ||
      status.state === "error" ||
      isManualCheck);

  if (!visible) return null;

  const isError = status.state === "error";
  const isReady = status.state === "downloaded";
  const isProgress =
    status.state === "available" || status.state === "downloading";
  const percent = status.state === "downloading" ? status.percent : 0;

  return (
    <aside
      className="fixed left-1/2 top-4 z-[100] w-[min(94vw,30rem)] -translate-x-1/2 border border-cyan-400/35 bg-slate-950/95 px-4 py-3 text-slate-100 shadow-[0_0_28px_rgba(34,211,238,0.16)] backdrop-blur-md"
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      data-testid="desktop-update-banner"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-cyan-300" aria-hidden="true">
          {isError ? (
            <AlertCircle className="h-4 w-4" />
          ) : isReady ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : isProgress ? (
            <Download className="h-4 w-4" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-[0.12em] text-cyan-100">
            {statusText(status)}
          </p>
          {isError && (
            <p className="mt-1 text-xs text-slate-400">
              Try “Check for Updates…” again from the app menu.
            </p>
          )}
          {isProgress && (
            <div
              className="mt-2 h-1 overflow-hidden bg-slate-800"
              aria-label={`${percent}% downloaded`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <div
                className="h-full bg-cyan-300 transition-[width] duration-300"
                style={{
                  width: `${status.state === "available" ? 0 : percent}%`,
                }}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss update status"
          data-testid="dismiss-desktop-update"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
