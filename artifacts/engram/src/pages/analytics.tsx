import { useTranslation } from "react-i18next";
import { useGetStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Cell } from "recharts";

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
