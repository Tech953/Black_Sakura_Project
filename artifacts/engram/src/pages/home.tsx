import { useMemo, useState } from "react";
import {
  getListEngramWorldModelQueryKey,
  getListMediaQueryKey,
  useGetStats,
  useGetPersonality,
  useListEngrams,
  useListEngramWorldModel,
  useListMedia,
  type WorldModelEntry,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { trackEvent } from "@/lib/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  ArrowRight,
  Brain,
  CheckCircle2,
  Database,
  ExternalLink,
  MonitorDown,
  X,
} from "lucide-react";

function mediaAssetId(source: string | undefined): number | null {
  if (!source?.startsWith("media:")) return null;
  const id = Number(source.slice("media:".length));
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const DESKTOP_PROMO_DISMISSED_KEY = "engram.desktopPromoDismissed";

function shouldShowDesktopPromo(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  if (/\bElectron\//i.test(navigator.userAgent)) return false;
  try {
    return window.localStorage.getItem(DESKTOP_PROMO_DISMISSED_KEY) !== "1";
  } catch {
    return true;
  }
}

export default function Home() {
  const { t } = useTranslation("home");
  const { data: stats, isLoading: statsLoading } = useGetStats();
  const { data: personality, isLoading: personalityLoading } = useGetPersonality();
  const { data: engrams } = useListEngrams();
  const [showDesktopPromo, setShowDesktopPromo] = useState(
    shouldShowDesktopPromo,
  );
  const activeEngram = useMemo(
    () => engrams?.find((engram) => engram.isChatActive) ?? engrams?.[0],
    [engrams],
  );
  const { data: worldModel, isLoading: worldModelLoading } = useListEngramWorldModel(
    activeEngram?.id ?? 0,
    {
      query: {
        enabled: activeEngram !== undefined,
        queryKey: getListEngramWorldModelQueryKey(activeEngram?.id ?? 0),
      },
    },
  );
  const { data: mediaAssets, isLoading: mediaLoading } = useListMedia(
    activeEngram ? { engramId: activeEngram.id } : undefined,
    {
      query: {
        enabled: activeEngram !== undefined,
        queryKey: getListMediaQueryKey(
          activeEngram ? { engramId: activeEngram.id } : undefined,
        ),
      },
    },
  );

  const dismissDesktopPromo = () => {
    setShowDesktopPromo(false);
    trackEvent("desktop_promo_dismissed", {
      location: "overview_callout",
    });
    try {
      window.localStorage.setItem(DESKTOP_PROMO_DISMISSED_KEY, "1");
    } catch {
      // The in-memory dismissal still applies when storage is unavailable.
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_hsl(var(--primary))]"></div>
          <span className="font-mono text-xs text-primary uppercase">{t("coreActive")}</span>
        </div>
      </div>

      {showDesktopPromo && (
        <div className="relative overflow-hidden border border-primary/25 bg-primary/[0.045] px-4 py-3 shadow-[inset_3px_0_0_hsl(var(--primary))]">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--primary)/0.06),transparent_45%)]" />
          <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 items-start gap-3 sm:items-center">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-primary/25 bg-primary/10 text-primary sm:mt-0">
                <MonitorDown className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold tracking-wider text-foreground">
                  {t("desktopPromoTitle")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("desktopPromoBody")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Link
                href="/download"
                data-testid="desktop-promo-link"
                onClick={() =>
                  trackEvent("desktop_promo_clicked", {
                    location: "overview_callout",
                  })
                }
                className="inline-flex h-9 items-center gap-2 border border-primary/40 bg-primary/10 px-3 font-mono text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary/20"
              >
                {t("desktopPromoAction")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                data-testid="desktop-promo-dismiss"
                onClick={dismissDesktopPromo}
                aria-label={t("desktopPromoDismiss")}
                className="flex h-9 w-9 items-center justify-center border border-border/60 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-white/5 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t("activePersona")} value={stats?.activePersona || t("common:none")} icon={Activity} loading={statsLoading} valueClass="text-accent glow-text" />
        <StatCard title={t("totalMemories")} value={stats?.totalMemories?.toString() || "0"} icon={Database} loading={statsLoading} />
        <StatCard title={t("beliefNodes")} value={stats?.totalBeliefs?.toString() || "0"} icon={CheckCircle2} loading={statsLoading} />
        <StatCard title={t("avgConfidence")} value={stats?.avgBeliefConfidence ? `${Math.round(stats.avgBeliefConfidence * 100)}%` : "0%"} icon={Brain} loading={statsLoading} />
      </div>

      <RecentPerceptionCard
        activeEngram={activeEngram}
        worldModel={worldModel}
        mediaAssets={mediaAssets}
        loading={worldModelLoading || mediaLoading}
        t={t}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="col-span-1 lg:col-span-2 bg-card/40 border-border/50 backdrop-blur-sm glow-box">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("personalityRadar")}</CardTitle>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
            {personalityLoading ? (
              <Skeleton className="h-56 w-56 sm:h-64 sm:w-64 rounded-full bg-primary/5" />
            ) : (
              <div className="relative w-56 h-56 sm:w-64 sm:h-64 max-w-full border border-primary/20 rounded-full flex items-center justify-center">
                <div className="absolute w-48 h-48 border border-primary/10 rounded-full"></div>
                <div className="absolute w-32 h-32 border border-primary/5 rounded-full"></div>
                {/* Placeholder for actual radar chart */}
                <div className="text-center font-mono text-xs text-muted-foreground/50">{t("radarVizOffline")}</div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1 bg-card/40 border-border/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("memoryDistribution")}</CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-4 w-full bg-primary/5" />
                <Skeleton className="h-4 w-5/6 bg-primary/5" />
                <Skeleton className="h-4 w-4/6 bg-primary/5" />
              </div>
            ) : (
              <div className="space-y-4">
                {(stats?.memoryByLayer ?? []).map((layer) => (
                  <div key={layer.layer} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="uppercase text-muted-foreground">{layer.layer}</span>
                      <span className="text-primary">{layer.count}</span>
                    </div>
                    <div className="h-1.5 bg-secondary overflow-hidden">
                      <div 
                        className="h-full bg-primary/50 transition-all" 
                        style={{ width: `${Math.min(100, (layer.count / Math.max(1, stats?.totalMemories ?? 0)) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RecentPerceptionCard({
  activeEngram,
  worldModel,
  mediaAssets,
  loading,
  t,
}: {
  activeEngram?: { id: number; name: string; symbol?: string };
  worldModel?: WorldModelEntry[];
  mediaAssets?: Array<{ id: number; filename: string; status: string }>;
  loading: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const assetsById = useMemo(
    () => new Map((mediaAssets ?? []).map((asset) => [asset.id, asset])),
    [mediaAssets],
  );
  const observations = useMemo(
    () =>
      (worldModel ?? [])
        .filter(
          (entry) =>
            entry.provenance === "observed" && mediaAssetId(entry.source) !== null,
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 4),
    [worldModel],
  );
  const processing = (mediaAssets ?? []).some(
    (asset) => asset.status === "pending" || asset.status === "processing",
  );

  return (
    <Card
      className="bg-card/40 border-cyan-400/20 backdrop-blur-sm"
      data-testid="recent-media-perception"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="font-display tracking-widest text-sm text-cyan-300/90">
            {t("recentPerceptionTitle")}
          </CardTitle>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {activeEngram
              ? t("recentPerceptionSubtitle", {
                  name: `${activeEngram.symbol ? `${activeEngram.symbol} ` : ""}${activeEngram.name}`,
                })
              : t("recentPerceptionNoEngram")}
          </p>
        </div>
        <Link
          href="/world-model"
          className="inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-cyan-300/80 hover:text-cyan-200"
          data-testid="link-recent-perception-world-model"
        >
          {t("openWorldModel")}
          <ExternalLink className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3" data-testid="recent-media-perception-loading">
            {Array.from({ length: 2 }).map((_, index) => (
              <Skeleton key={index} className="h-16 bg-primary/5" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {processing && (
              <p
                className="border border-amber-400/20 bg-amber-400/[0.04] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-amber-300/80"
                data-testid="recent-media-perception-processing"
              >
                {t("recentPerceptionProcessing")}
              </p>
            )}
            {observations.length ? (
              observations.map((entry) => {
                const assetId = mediaAssetId(entry.source)!;
                const asset = assetsById.get(assetId);
                return (
                  <div
                    key={entry.id}
                    className="border-b border-border/30 pb-3 last:border-0 last:pb-0"
                    data-testid={`recent-media-observation-${entry.id}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed text-foreground/80">
                          {entry.content}
                        </p>
                        <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground/60">
                          <span className="text-cyan-300/80">
                            {t("recentPerceptionObserved")}
                          </span>
                          <span>{Math.round(entry.confidence * 100)}%</span>
                        </div>
                      </div>
                      {asset ? (
                        <Link
                          href={`/media?asset=${assetId}`}
                          className="inline-flex max-w-[12rem] shrink-0 items-center gap-1 truncate font-mono text-[10px] text-cyan-300/80 hover:text-cyan-200"
                          data-testid={`link-recent-media-source-${entry.id}`}
                          title={asset.filename}
                        >
                          <span className="truncate">{asset.filename}</span>
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </Link>
                      ) : (
                        <span
                          className="max-w-[12rem] shrink-0 truncate font-mono text-[10px] text-muted-foreground/50"
                          data-testid={`recent-media-source-deleted-${entry.id}`}
                        >
                          {t("recentPerceptionSourceUnavailable")}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <p
                className="py-3 text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60"
                data-testid="recent-media-perception-empty"
              >
                {processing
                  ? t("recentPerceptionProcessing")
                  : t("recentPerceptionEmpty")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ title, value, icon: Icon, loading, valueClass = "" }: any) {
  return (
    <Card className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors">
      <CardContent className="p-6 flex flex-col gap-2">
        <div className="flex justify-between items-center text-muted-foreground mb-2">
          <span className="font-mono text-xs uppercase tracking-wider">{title}</span>
          <Icon className="w-4 h-4 opacity-50" />
        </div>
        {loading ? (
          <Skeleton className="h-8 w-24 bg-primary/10" />
        ) : (
          <span className={`text-3xl font-display font-bold ${valueClass}`}>{value}</span>
        )}
      </CardContent>
    </Card>
  );
}
