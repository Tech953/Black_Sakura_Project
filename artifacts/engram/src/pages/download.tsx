import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation, Trans } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Download,
  Apple,
  MonitorDown,
  Terminal as TerminalIcon,
  Smartphone,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";

// GitHub repository (owner/repo) that hosts the releases produced by
// .github/workflows/desktop-build.yml. Used here ONLY for the external
// "release notes" link; the actual downloads are served same-origin by this
// app's API (see below), so the browser never calls the GitHub API directly.
const GITHUB_REPO =
  (import.meta.env.VITE_GITHUB_REPO as string | undefined)?.trim() ||
  "Tech953/Ch-IO";

const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases`;

// Same-origin download endpoints served by this app's API
// (artifacts/api-server routes/download.ts). Each meta endpoint reports
// availability + source (a bundled file committed into the deploy, else the
// latest GitHub release proxied through this origin); the binary endpoints
// stream the file itself. Everything stays on the deploy's own origin.
const DESKTOP_META_URL = "/api/download/desktop";
const ANDROID_META_URL = "/api/download/android";
const ANDROID_APK_URL = "/api/download/android.apk";

type Os = "mac" | "win" | "linux" | "android";
type DesktopOs = "mac" | "win" | "linux";

type DesktopInstaller = {
  os: DesktopOs;
  ext: string;
  filename: string;
  sizeBytes: number;
  downloadPath: string;
};

type DesktopMeta = {
  available: boolean;
  source: "bundled" | "github" | null;
  version: string | null;
  installers: DesktopInstaller[];
};

type AndroidMeta = {
  available: boolean;
  source: "bundled" | "github" | null;
  version: string | null;
  filename: string | null;
  sizeBytes: number | null;
  downloadPath: string | null;
};

type DownloadLink = {
  key: string;
  href: string;
  label: string;
  size?: number;
};

const OS_META: Record<Os, { nameKey: string; icon: typeof Apple; noteKey: string }> = {
  mac: { nameKey: "osMacName", icon: Apple, noteKey: "osMacNote" },
  win: { nameKey: "osWinName", icon: MonitorDown, noteKey: "osWinSlimNote" },
  linux: { nameKey: "osLinuxName", icon: TerminalIcon, noteKey: "osLinuxNote" },
  android: { nameKey: "osAndroidName", icon: Smartphone, noteKey: "osAndroidNote" },
};

const OS_ORDER: Os[] = ["mac", "win", "linux", "android"];

function detectOs(): Os | null {
  if (typeof navigator === "undefined") return null;
  const ua = `${navigator.userAgent} ${navigator.platform ?? ""}`.toLowerCase();
  // Android must be checked first: its UA string also contains "linux", so the
  // Linux check below would otherwise swallow it.
  if (ua.includes("android")) return "android";
  if (ua.includes("mac")) return "mac";
  if (ua.includes("win")) return "win";
  if (ua.includes("linux") || ua.includes("x11")) return "linux";
  return null;
}

function formatSize(bytes?: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} responded ${res.status}`);
  return res.json() as Promise<T>;
}

export default function DownloadPage() {
  const { t } = useTranslation("download");
  const detectedOs = useMemo(detectOs, []);

  // Desktop installers (mac/win/linux) — same-origin meta from this app's API.
  const desktopQuery = useQuery<DesktopMeta>({
    queryKey: ["desktop-download-meta"],
    queryFn: () => fetchJson<DesktopMeta>(DESKTOP_META_URL),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Android — same-origin meta from this app's API.
  const androidQuery = useQuery<AndroidMeta>({
    queryKey: ["android-download-meta"],
    queryFn: () => fetchJson<AndroidMeta>(ANDROID_META_URL),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const desktopByOs = useMemo(() => {
    const map: Record<DesktopOs, DownloadLink[]> = { mac: [], win: [], linux: [] };
    for (const inst of desktopQuery.data?.installers ?? []) {
      if (!map[inst.os]) continue;
      map[inst.os].push({
        key: inst.filename,
        href: inst.downloadPath,
        label: t("downloadExt", { ext: inst.ext }),
        size: inst.sizeBytes,
      });
    }
    // Stable order within an OS (e.g. Linux .AppImage before .deb).
    for (const os of ["mac", "win", "linux"] as DesktopOs[]) {
      map[os].sort((a, b) => a.label.localeCompare(b.label));
    }
    return map;
  }, [desktopQuery.data, t]);

  const android = androidQuery.data;
  const androidLinks: DownloadLink[] = useMemo(() => {
    if (!android?.available) return [];
    return [
      {
        key: android.filename ?? "engram.apk",
        href: android.downloadPath ?? ANDROID_APK_URL,
        label: t("installApk"),
        size: android.sizeBytes ?? undefined,
      },
    ];
  }, [android, t]);

  const linksByOs: Record<Os, DownloadLink[]> = {
    mac: desktopByOs.mac,
    win: desktopByOs.win,
    linux: desktopByOs.linux,
    android: androidLinks,
  };

  const hasAnyCard = OS_ORDER.some((os) => linksByOs[os].length > 0);
  const isLoading = desktopQuery.isLoading || androidQuery.isLoading;
  const isError = desktopQuery.isError && androidQuery.isError;

  const version = desktopQuery.data?.version ?? android?.version ?? null;

  const orderedOs = useMemo(
    () =>
      [...OS_ORDER].sort((a, b) => {
        if (a === detectedOs && b !== detectedOs) return -1;
        if (b === detectedOs && a !== detectedOs) return 1;
        return OS_ORDER.indexOf(a) - OS_ORDER.indexOf(b);
      }),
    [detectedOs],
  );

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">
            {t("title")}
          </h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitleSlim")}
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          {isLoading ? (
            <Skeleton className="h-6 w-28 bg-primary/10" />
          ) : version ? (
            <span className="px-3 py-1.5 border border-primary/30 text-primary uppercase tracking-widest bg-primary/5">
              {t("latestVersion", { version })}
            </span>
          ) : null}
        </div>
      </div>

      {/* Auto-update note */}
      <Card className="bg-card/40 border-primary/20 backdrop-blur-sm">
        <CardContent className="p-4 flex items-start gap-3">
          <RefreshCw className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">
              {t("autoUpdateHeadline")}
            </span>{" "}
            {t("autoUpdateBody")}
          </p>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-44 w-full bg-primary/5" />
          ))}
        </div>
      )}

      {!isLoading && hasAnyCard && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {orderedOs.map((os) => {
            const links = linksByOs[os];
            if (links.length === 0) return null;
            const meta = OS_META[os];
            const Icon = meta.icon;
            const isRecommended = os === detectedOs;
            return (
              <Card
                key={os}
                className={`bg-card/40 backdrop-blur-sm flex flex-col ${
                  isRecommended
                    ? "border-primary glow-box ring-1 ring-primary/30"
                    : "border-border/50"
                }`}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="font-display tracking-widest text-sm text-primary/90 flex items-center gap-2">
                    <Icon className="w-5 h-5" />
                    {t(meta.nameKey)}
                    {isRecommended && (
                      <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary font-mono uppercase tracking-widest">
                        <CheckCircle2 className="w-3 h-3" />{" "}
                        {os === "android" ? t("yourDevice") : t("yourOs")}
                      </span>
                    )}
                  </CardTitle>
                  <p className="text-xs font-mono text-muted-foreground">
                    {t(meta.noteKey)}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 mt-auto">
                  {links.map((link) => (
                    <a
                      key={link.key}
                      href={link.href}
                      download={link.key}
                      className={`flex items-center gap-2 px-3 py-2.5 font-mono text-xs uppercase tracking-wider transition-colors border ${
                        isRecommended
                          ? "border-primary/50 text-primary bg-primary/10 hover:bg-primary/20"
                          : "border-border/60 text-foreground hover:bg-white/5 hover:border-primary/40"
                      }`}
                    >
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="truncate">{link.label}</span>
                      {link.size ? (
                        <span className="ml-auto text-muted-foreground normal-case">
                          {formatSize(link.size)}
                        </span>
                      ) : null}
                    </a>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {!isLoading && !hasAnyCard && (
        <Card
          className={`bg-card/40 backdrop-blur-sm ${
            isError ? "border-destructive/40" : "border-border/50"
          }`}
        >
          <CardContent className="p-6 flex flex-col items-center text-center gap-3">
            <AlertTriangle
              className={`w-8 h-8 ${
                isError ? "text-destructive/80" : "text-muted-foreground/60"
              }`}
            />
            {isError ? (
              <p className="text-sm text-muted-foreground max-w-md">
                {t("errorReach")}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground max-w-lg">
                <Trans
                  t={t}
                  i18nKey="noInstallers"
                  components={[<code className="text-primary/80" />]}
                />
              </p>
            )}
            <a
              href={RELEASES_PAGE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 border border-primary/40 text-primary font-mono text-xs uppercase tracking-widest hover:bg-primary/10 transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> {t("openReleases")}
            </a>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-border/40">
        <p className="text-xs font-mono text-muted-foreground/70">
          {t("servedNote")}
        </p>
        <a
          href={RELEASES_PAGE}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 text-xs font-mono text-primary/80 hover:text-primary uppercase tracking-widest transition-colors"
        >
          {t("allVersions")} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}
