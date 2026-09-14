import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  X,
} from "lucide-react";
import {
  clampProgress,
  statusText,
  type DesktopUpdateCopy,
  type DesktopUpdateStatus,
} from "./desktop-update-banner-logic";

type DesktopBridge = {
  getAppInfo: () => Promise<{ updateStatus: DesktopUpdateStatus }>;
  installDownloadedUpdate: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateStatus: (
    callback: (status: DesktopUpdateStatus) => void,
  ) => () => void;
};

function desktopBridge(): DesktopBridge | undefined {
  return (window as Window & { engram?: DesktopBridge }).engram;
}

export default function DesktopUpdateBanner() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<DesktopUpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const previousState = useRef<DesktopUpdateStatus["state"]>("idle");
  const bannerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);

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

  const isError = status.state === "error";
  const isReady = status.state === "downloaded";
  const isProgress =
    status.state === "available" || status.state === "downloading";
  const isDownloading = status.state === "downloading";
  const percent = isDownloading ? clampProgress(status.percent) : 0;
  const updateCopy: DesktopUpdateCopy = {
    checking: t("update.checking"),
    availableWithVersion: t("update.availableWithVersion"),
    available: t("update.available"),
    downloading: t("update.downloading"),
    downloaded: t("update.downloaded"),
    error: t("update.error"),
    upToDate: t("update.upToDate"),
  };
  const dismissNotice = (): void => {
    setDismissed(true);
    const target = returnFocusRef.current;
    if (target?.isConnected) {
      window.requestAnimationFrame(() => {
        if (target.isConnected) target.focus({ preventScroll: true });
      });
    }
  };

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        !bannerRef.current?.contains(activeElement)
      ) {
        returnFocusRef.current = activeElement;
      }
    }
    wasVisibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dismissNotice();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible]);

  const handleRestart = async (): Promise<void> => {
    const bridge = desktopBridge();
    if (!bridge || installing) return;
    setInstalling(true);
    try {
      const result = await bridge.installDownloadedUpdate();
      if (!result.ok) {
        setStatus({
          state: "error",
          message:
            result.error ?? "The downloaded update could not be installed.",
        });
        setInstalling(false);
      }
    } catch (error) {
      setStatus({
        state: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      setInstalling(false);
    }
  };

  if (!visible) return null;

  return (
    <aside
      ref={bannerRef}
      className="fixed left-1/2 top-4 z-[100] w-[min(94vw,30rem)] -translate-x-1/2 border border-cyan-400/35 bg-slate-950/95 px-4 py-3 text-slate-100 shadow-[0_0_28px_rgba(34,211,238,0.16)] backdrop-blur-md"
      aria-label="Desktop update notification"
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
          <p
            id="desktop-update-status"
            className="font-mono text-xs uppercase tracking-[0.12em] text-cyan-100"
            role={isError ? "alert" : isDownloading ? undefined : "status"}
            aria-live={isError ? "assertive" : isDownloading ? "off" : "polite"}
            aria-atomic="true"
            aria-describedby={isError ? "desktop-update-error" : undefined}
          >
            {statusText(status, updateCopy)}
          </p>
          {isError && (
            <>
              <p
                id="desktop-update-error"
                className="mt-1 text-xs text-slate-300"
              >
                {status.message}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Try “Check for Updates…” again from the app menu.
              </p>
            </>
          )}
          {isProgress && (
            <div
              className="mt-2 h-1 overflow-hidden bg-slate-800"
              aria-label="Update download progress"
              aria-valuetext={
                isDownloading ? `${percent}% downloaded` : "Download starting"
              }
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
          {isReady && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="rounded-sm bg-cyan-300 px-2.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-950 transition-colors hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:cursor-wait disabled:opacity-60"
                onClick={() => void handleRestart()}
                disabled={installing}
                data-testid="restart-desktop-update"
              >
                {installing ? "Restarting…" : "Restart now"}
              </button>
              <button
                type="button"
                className="rounded-sm px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
                onClick={dismissNotice}
                data-testid="later-desktop-update"
              >
                Later
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
          onClick={dismissNotice}
          aria-label="Dismiss update notification"
          data-testid="dismiss-desktop-update"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
