import { useTranslation } from "react-i18next";
import { useGetEngramStates, useGetStats, useListEngrams } from "@workspace/api-client-react";
import type { EngramLiveState } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from "recharts";
import { Activity, AlertTriangle, Gauge, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { getGetEngramStatesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";

const LAYER_COLORS: Record<string, string> = {
  working: "#22d3ee",
  episodic: "#a78bfa",
  semantic: "#34d399",
  preference: "#fbbf24",
  reflective: "#fb7185",
  procedural: "#38bdf8",
};

const CUSTOM_TOOLTIP_STYLE = {
  backgroundColor: "hsl(230 50% 7%)",
  border: "1px solid hsl(230 50% 15%)",
  borderRadius: "0",
  fontFamily: "JetBrains Mono, monospace",
  fontSize: "11px",
  color: "hsl(210 40% 98%)",
};

export default function Analytics() {
  const { t } = useTranslation("analytics");
  const { data: stats, isLoading } = useGetStats();
  const { data: engrams, isLoading: engramsLoading } = useListEngrams();
  const {
    data: liveStates,
    isLoading: statesLoading,
    isError: liveStatesError,
  } = useGetEngramStates({
    query: {
      refetchInterval: 4000,
      queryKey: getGetEngramStatesQueryKey(),
    },
  });

  const liveById = new Map(
    (liveStatesError ? [] : liveStates ?? []).map((state) => [state.engramId, state]),
  );
  const rosterLoading = engramsLoading || statesLoading;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { id: "memories", label: t("metrics.memories"), value: stats?.totalMemories },
          { id: "beliefs", label: t("metrics.beliefs"), value: stats?.totalBeliefs },
          { id: "journal", label: t("metrics.journal"), value: stats?.totalJournalEntries },
          { id: "initiatives", label: t("metrics.initiatives"), value: stats?.totalInitiativeEvents },
          { id: "revisions", label: t("metrics.revisions"), value: stats?.evolutionRevisions },
        ].map(({ id, label, value }) => (
          <Card key={id} className="bg-card/40 border-border/50 backdrop-blur-sm">
            <CardContent className="p-4">
              <p className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider mb-2">{label}</p>
              {isLoading ? <Skeleton className="h-7 w-12 bg-primary/10" /> : (
                <p className="font-display text-2xl font-bold text-primary" data-testid={`stat-${id}`}>{value ?? 0}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Fleet pressure overview */}
      <Card className="bg-card/40 border-border/50 backdrop-blur-sm" data-testid="pressure-roster">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 font-display tracking-widest text-sm text-primary/80">
                <Gauge className="h-4 w-4" />
                {t("pressureOverview")}
              </CardTitle>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground/60">{t("pressureOverviewSubtitle")}</p>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
              <Activity className="h-3 w-3" />
              {t("pressureOverviewLive")}
            </div>
          </div>
          {liveStatesError && (
            <div
              className="mt-3 flex items-center gap-1.5 border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 font-mono text-[9px] uppercase tracking-wider text-amber-300/90"
              role="status"
              aria-live="polite"
              data-testid="pressure-live-status"
            >
              <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t(liveStates === undefined ? "pressureLiveUnavailable" : "pressureLiveStale")}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {rosterLoading ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-28 bg-primary/5" />
              ))}
            </div>
          ) : !engrams?.length ? (
            <p className="py-6 text-center font-mono text-xs uppercase tracking-wider text-muted-foreground/60">
              {t("pressureOverviewEmpty")}
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {engrams.map((engram) => {
                const live = liveById.get(engram.id);
                const threshold = live?.initiationThreshold ?? engram.initiationThreshold;
                const percent = live
                  ? Math.min(100, Math.round((live.topCharge / Math.max(0.01, threshold)) * 100))
                  : null;
                const topDrive = live?.drives.reduce(
                  (best, drive) => (!best || drive.charge > best.charge ? drive : best),
                  live.drives[0],
                );
                const status = getRosterStatus(live);
                const statusStyle = ROSTER_STATUS_STYLES[status];

                return (
                  <div
                    key={engram.id}
                    className="border border-border/40 bg-background/20 p-3.5"
                    data-testid={`pressure-roster-item-${engram.id}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="text-xl leading-none" aria-hidden="true">{engram.symbol}</span>
                        <div className="min-w-0">
                          <div
                            className="truncate font-mono text-xs uppercase tracking-wider text-foreground/90"
                            data-testid={`pressure-name-${engram.id}`}
                            dir="auto"
                          >
                            {engram.name}
                          </div>
                          <div className="truncate font-mono text-[9px] uppercase text-muted-foreground/50" dir="auto">
                            {topDrive?.label ?? t("pressureUnavailable")}
                          </div>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={`font-mono text-[8px] uppercase ${statusStyle.badge}`}
                        data-testid={`pressure-status-${engram.id}`}
                        dir="auto"
                      >
                        {t(statusStyle.label)}
                      </Badge>
                    </div>
                    <div className="mt-3 space-y-1.5">
                      <div className="flex items-center justify-between font-mono text-[10px]">
                        <span
                          className="uppercase tracking-wider text-muted-foreground/60"
                          data-testid={`pressure-label-${engram.id}`}
                          dir="auto"
                        >
                          {t("pressure")}
                        </span>
                        <span className="tabular-nums text-foreground/70" data-testid={`pressure-value-${engram.id}`} dir="ltr">
                          {live && percent !== null
                            ? `${live.topCharge.toFixed(2)} / ${threshold.toFixed(2)} · ${percent}%`
                            : `— / ${threshold.toFixed(2)} · —%`}
                        </span>
                      </div>
                      {live && percent !== null && (
                        <div
                          className="h-1.5 overflow-hidden bg-secondary"
                          role="progressbar"
                          aria-label={t("pressureProgressLabel", { name: engram.name })}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={percent}
                        >
                          <div className={`h-full transition-all ${status === "ready" ? "bg-rose-400/80" : "bg-primary/60"}`} style={{ width: `${percent}%` }} />
                        </div>
                      )}
                    </div>
                    <Link
                      href={`/environment?engramId=${engram.id}`}
                      aria-label={t("openEnvironment", { name: engram.name })}
                      data-testid={`button-open-environment-${engram.id}`}
                      className="mt-3 flex min-h-8 items-center justify-center gap-1.5 border border-primary/25 px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider text-primary/80 transition-colors hover:border-primary/60 hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                      <span dir="auto">{t("openEnvironment")}</span>
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Memory by layer */}
        <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("memoryByLayer")}</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {isLoading ? <Skeleton className="h-full bg-primary/5" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.memoryByLayer ?? []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(230 50% 15%)" vertical={false} />
                  <XAxis dataKey="layer" tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false}
                    tickFormatter={(v: string) => v.toUpperCase()} />
                  <YAxis tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="count" radius={0}>
                    {(stats?.memoryByLayer ?? []).map((entry) => (
                      <Cell key={entry.layer} fill={LAYER_COLORS[entry.layer] ?? "hsl(190 90% 50%)"} fillOpacity={0.7} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Initiative events over time */}
        <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("initiativeEvents")}</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {isLoading ? <Skeleton className="h-full bg-primary/5" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats?.initiativeByDay ?? []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(230 50% 15%)" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false}
                    tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="count" stroke="hsl(190 90% 50%)" strokeWidth={2} dot={{ fill: "hsl(190 90% 50%)", r: 3 }}
                    activeDot={{ r: 5, fill: "hsl(190 90% 50%)" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Belief confidence distribution */}
        <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("beliefConfidenceDistribution")}</CardTitle>
          </CardHeader>
          <CardContent className="h-56">
            {isLoading ? <Skeleton className="h-full bg-primary/5" /> : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats?.beliefConfidenceDistribution ?? []} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke="hsl(230 50% 15%)" vertical={false} />
                  <XAxis dataKey="range" tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontFamily: "JetBrains Mono", fontSize: 9, fill: "hsl(210 30% 60%)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={CUSTOM_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                  <Bar dataKey="count" radius={0}>
                    {(stats?.beliefConfidenceDistribution ?? []).map((entry, i) => {
                      const colors = ["#fb7185", "#fbbf24", "#60a5fa", "#34d399"];
                      return <Cell key={entry.range} fill={colors[i]} fillOpacity={0.7} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Initiative score formula */}
        <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="font-display tracking-widest text-sm text-primary/80">{t("initiativeScoreFormula")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 border border-primary/20 bg-primary/5 font-mono text-xs sm:text-sm text-primary text-center break-words">
              {t("formula")}
            </div>
            <p className="font-mono text-xs text-muted-foreground/70">{t("thresholdNote")}</p>
            <div className="space-y-2">
              {[
                { label: "importance", desc: t("factors.importanceDesc"), color: "text-rose-400" },
                { label: "confidence", desc: t("factors.confidenceDesc"), color: "text-amber-400" },
                { label: "timing", desc: t("factors.timingDesc"), color: "text-sky-400" },
                { label: "novelty", desc: t("factors.noveltyDesc"), color: "text-emerald-400" },
              ].map(f => (
                <div key={f.label} className="flex gap-3 items-start">
                  <span className={`font-mono text-xs font-bold w-20 shrink-0 ${f.color}`}>{f.label}</span>
                  <span className="font-mono text-xs text-muted-foreground/60">{f.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

type RosterStatus = "charging" | "ready" | "cooldown" | "paused";

const ROSTER_STATUS_STYLES: Record<RosterStatus, { label: string; badge: string }> = {
  charging: { label: "statusCharging", badge: "border-primary/40 text-primary/70" },
  ready: { label: "statusReady", badge: "border-rose-500/50 text-rose-400" },
  cooldown: { label: "statusCooldown", badge: "border-sky-500/50 text-sky-400" },
  paused: { label: "statusPaused", badge: "border-amber-500/50 text-amber-400" },
};

function getRosterStatus(live: EngramLiveState | undefined): RosterStatus {
  if (!live?.autonomyEnabled || live.inBackoff) return "paused";
  if (live.inCooldown) return "cooldown";
  if (live.ready) return "ready";
  return "charging";
}
