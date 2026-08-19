import { useGetStats, useGetPersonality } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Brain, Database, CheckCircle2 } from "lucide-react";

export default function Home() {
  const { t } = useTranslation("home");
  const { data: stats, isLoading: statsLoading } = useGetStats();
  const { data: personality, isLoading: personalityLoading } = useGetPersonality();

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title={t("activePersona")} value={stats?.activePersona || t("common:none")} icon={Activity} loading={statsLoading} valueClass="text-accent glow-text" />
        <StatCard title={t("totalMemories")} value={stats?.totalMemories?.toString() || "0"} icon={Database} loading={statsLoading} />
        <StatCard title={t("beliefNodes")} value={stats?.totalBeliefs?.toString() || "0"} icon={CheckCircle2} loading={statsLoading} />
        <StatCard title={t("avgConfidence")} value={stats?.avgBeliefConfidence ? `${Math.round(stats.avgBeliefConfidence * 100)}%` : "0%"} icon={Brain} loading={statsLoading} />
      </div>

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
                {stats?.memoryByLayer.map((layer) => (
                  <div key={layer.layer} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="uppercase text-muted-foreground">{layer.layer}</span>
                      <span className="text-primary">{layer.count}</span>
                    </div>
                    <div className="h-1.5 bg-secondary overflow-hidden">
                      <div 
                        className="h-full bg-primary/50 transition-all" 
                        style={{ width: `${Math.min(100, (layer.count / Math.max(1, stats.totalMemories)) * 100)}%` }}
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
