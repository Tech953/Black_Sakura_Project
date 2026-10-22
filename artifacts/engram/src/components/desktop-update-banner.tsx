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
  chooseDesktopUpdateBannerPosition,
  clampProgress,
  isRetryableInstallFailure,
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
  const { t: tCommon } = useTranslation("common");
  const [status, setStatus] = useState<DesktopUpdateStatus>({ state: "idle" });
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [bannerPosition, setBannerPosition] = useState<"top" | "bottom">("top");
  const previousState = useRef<DesktopUpdateStatus["state"]>("idle");
  const bannerRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge) return;

    let mounted = true;
    const unsubscribe = bridge.onUpdateStatus((next) => {
      if (mounted) {
        if (isRetryableInstallFailure(next)) setInstalling(false);
        setStatus(next);
      }
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
  const retryableInstallFailure = isRetryableInstallFailure(status);
  const bannerPositionClass =
    bannerPosition === "bottom" ? "bottom-4 !top-auto" : "top-16 lg:top-4";
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
    if (!visible) {
      wasVisibleRef.current = false;
      setBannerPosition("top");
      return;
    }

    if (!wasVisibleRef.current) {
      const activeElement = document.activeElement;
      returnFocusRef.current =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        activeElement !== document.documentElement &&
        !bannerRef.current?.contains(activeElement)
          ? activeElement
          : null;
      wasVisibleRef.current = true;
    }

    let frame = 0;
    const reposition = (): void => {
      const banner = bannerRef.current;
      const target = returnFocusRef.current;
      if (!banner || !target?.isConnected) {
        setBannerPosition("top");
        return;
      }

      const rem = Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      );
      const remSize = Number.isFinite(rem) && rem > 0 ? rem : 16;
      const top = window.matchMedia("(min-width: 1024px)").matches
        ? remSize
        : remSize * 4;
      const rect = banner.getBoundingClientRect();
      setBannerPosition(
        chooseDesktopUpdateBannerPosition(
          {
            left: rect.left,
            right: rect.right,
            top,
            bottom: top + rect.height,
          },
          target.getBoundingClientRect(),
          window.innerHeight,
          remSize,
        ),
      );
    };
    const scheduleReposition = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(reposition);
    };

    const banner = bannerRef.current;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(scheduleReposition);
    if (banner) resizeObserver?.observe(banner);

    scheduleReposition();
    window.addEventListener("resize", scheduleReposition);
    window.addEventListener("scroll", scheduleReposition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleReposition);
      window.removeEventListener("scroll", scheduleReposition, true);
      resizeObserver?.disconnect();
    };
  }, [visible, status.state]);

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
    const version =
      status.state === "downloaded" ||
      (status.state === "error" && status.updateReady)
        ? status.version
        : undefined;
    const setInstallFailure = (message: string): void => {
      setStatus({
        state: "error",
        message,
        retryable: true,
        updateReady: true,
        ...(version === undefined ? {} : { version }),
      });
    };
    setInstalling(true);
    try {
      const result = await bridge.installDownloadedUpdate();
      if (!result.ok) {
        setInstallFailure(
          result.error ?? "The downloaded update could not be installed.",
        );
        setInstalling(false);
      }
    } catch {
      setInstallFailure("The downloaded update could not be installed.");
      setInstalling(false);
    }
  };

  if (!visible) return null;

  return (
    <aside
      ref={bannerRef}
      className={`fixed left-1/2 md:left-[calc(50%_+_8rem)] lg:left-1/2 ${bannerPositionClass} z-[100] w-[min(94vw,30rem)] max-h-[40vh] -translate-x-1/2 overflow-x-hidden overflow-y-auto overscroll-contain border border-cyan-400/35 bg-slate-950/95 px-4 py-3 text-slate-100 shadow-[0_0_28px_rgba(34,211,238,0.16)] backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300`}
      aria-label="Desktop update notification"
      data-testid="desktop-update-banner"
      data-update-state={status.state}
      tabIndex={0}
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="mt-0.5 shrink-0 text-cyan-300" aria-hidden="true">
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
            className="break-words font-mono text-xs uppercase tracking-[0.12em] text-cyan-100"
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
                className="mt-1 break-words text-xs text-slate-300"
              >
                {status.message}
              </p>
              {retryableInstallFailure ? (
                status.version && (
                  <p
                    className="mt-1 font-mono text-[10px] text-slate-400"
                    data-testid="desktop-update-version"
                  >
                    ENGRAM {status.version}
                  </p>
                )
              ) : (
                <p className="mt-1 break-words text-xs text-slate-400">
                  Try “Check for Updates…” again from the app menu.
                </p>
              )}
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
          {(isReady || retryableInstallFailure) && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="min-h-9 max-w-full whitespace-normal break-words rounded-sm bg-cyan-300 px-2.5 py-2 text-center font-mono text-[10px] font-semibold uppercase leading-tight tracking-[0.1em] text-slate-950 transition-colors hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:cursor-wait disabled:opacity-60"
                onClick={() => void handleRestart()}
                disabled={installing}
                data-testid={
                  retryableInstallFailure
                    ? "retry-desktop-update"
                    : "restart-desktop-update"
                }
              >
                {installing
                  ? "Restarting…"
                  : retryableInstallFailure
                    ? tCommon("retry")
                    : "Restart now"}
              </button>
              <button
                type="button"
                className="min-h-9 max-w-full whitespace-normal break-words rounded-sm px-2.5 py-2 font-mono text-[10px] uppercase leading-tight tracking-[0.1em] text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
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
          className="sticky top-0 min-h-9 min-w-9 shrink-0 rounded-sm p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
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
