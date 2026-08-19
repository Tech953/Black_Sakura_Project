import { useTranslation } from "react-i18next";
import { useListEvolutionLog } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

export default function Evolution() {
  const { t } = useTranslation("evolution");
  const { data: entries, isLoading } = useListEvolutionLog();

  const sorted = entries ? [...entries].sort((a, b) => b.revision - a.revision) : [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="bg-card/20 border border-border/30 p-4 font-mono text-xs text-muted-foreground space-y-1">
        <p className="text-primary/70">{t("designPrinciple")}</p>
        <p>{t("designPrincipleBody")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 bg-primary/5" />)}
        </div>
      ) : !sorted.length ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
          <TrendingUp className="w-8 h-8 mb-4 opacity-30" />
          <p className="text-xs uppercase tracking-widest">{t("emptyState")}</p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline spine */}
          <div className="absolute left-4 md:left-6 top-0 bottom-0 w-px bg-gradient-to-b from-primary/40 via-primary/20 to-transparent" />

          <div className="space-y-6 pl-12 md:pl-16">
            {sorted.map((entry) => {
              const conf = Math.round(entry.confidence * 100);
              const confColor = conf >= 80 ? "text-emerald-400" : conf >= 60 ? "text-amber-400" : "text-rose-400";
              return (
                <div key={entry.id} className="relative" data-testid={`card-evolution-${entry.id}`}>
                  {/* Timeline node */}
                  <div className="absolute -left-8 md:-left-10 top-5 flex items-center justify-center w-8 h-8 rounded-full border border-primary/30 bg-background text-primary font-mono text-xs font-bold">
                    {entry.revision}
                  </div>

                  <Card className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors">
                    <CardContent className="p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2 flex-wrap">
                            <span className="font-mono text-[10px] uppercase text-muted-foreground/60 tracking-widest">
                              {t("triggerLabel")} <span className="text-primary/70">{entry.trigger}</span>
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground/40">{new Date(entry.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="font-sans text-sm text-foreground/90 leading-relaxed font-medium">{entry.description}</p>
                        </div>
                        <div className={`font-mono text-xl font-bold tabular-nums shrink-0 ${confColor}`}>{conf}%</div>
                      </div>

                      <div className="h-0.5 bg-secondary overflow-hidden">
                        <div className={`h-full transition-all ${conf >= 80 ? "bg-emerald-400/60" : conf >= 60 ? "bg-amber-400/60" : "bg-rose-400/60"}`} style={{ width: `${conf}%` }} />
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] font-mono pt-1">
                        {entry.evidenceConsidered && (
                          <div>
                            <span className="text-muted-foreground/60 uppercase block mb-1">{t("evidence")}</span>
                            <p className="text-foreground/60 leading-relaxed">{entry.evidenceConsidered}</p>
                          </div>
                        )}
                        {entry.expectedImpact && (
                          <div>
                            <span className="text-muted-foreground/60 uppercase block mb-1">{t("expectedImpact")}</span>
                            <p className="text-foreground/60 leading-relaxed">{entry.expectedImpact}</p>
                          </div>
                        )}
                        {entry.validationOutcome && (
                          <div>
                            <span className="text-muted-foreground/60 uppercase block mb-1">{t("validation")}</span>
                            <p className="text-emerald-400/70 leading-relaxed">{entry.validationOutcome}</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
