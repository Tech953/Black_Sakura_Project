import { useTranslation } from "react-i18next";
import { useListPersonas, useSetActivePersona, getListPersonasQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PERSONA_COLORS: Record<string, string> = {
  Archivist: "border-violet-500/30 hover:border-violet-500/60",
  Analyst: "border-sky-500/30 hover:border-sky-500/60",
  Companion: "border-emerald-500/30 hover:border-emerald-500/60",
  Sentinel: "border-amber-500/30 hover:border-amber-500/60",
  Explorer: "border-rose-500/30 hover:border-rose-500/60",
  Philosopher: "border-indigo-500/30 hover:border-indigo-500/60",
};

const PERSONA_ACTIVE_COLORS: Record<string, string> = {
  Archivist: "border-violet-400 bg-violet-500/10",
  Analyst: "border-sky-400 bg-sky-500/10",
  Companion: "border-emerald-400 bg-emerald-500/10",
  Sentinel: "border-amber-400 bg-amber-500/10",
  Explorer: "border-rose-400 bg-rose-500/10",
  Philosopher: "border-indigo-400 bg-indigo-500/10",
};

const PERSONA_GLOW: Record<string, string> = {
  Archivist: "text-violet-400",
  Analyst: "text-sky-400",
  Companion: "text-emerald-400",
  Sentinel: "text-amber-400",
  Explorer: "text-rose-400",
  Philosopher: "text-indigo-400",
};

export default function Personas() {
  const { t } = useTranslation("personas");
  const { data: personas, isLoading } = useListPersonas();
  const setActive = useSetActivePersona();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  function handleActivate(personaId: number, name: string) {
    setActive.mutate({ data: { personaId } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPersonasQueryKey() });
        toast({ title: t("activatedTitle"), description: t("activatedDescription", { name }) });
      }
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
      </div>

      <div className="bg-card/20 border border-border/30 p-4 font-mono text-xs text-muted-foreground space-y-1">
        <p className="text-primary/70">{t("systemNote")}</p>
        <p>{t("systemNoteBody")}</p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56 bg-primary/5" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {personas?.map(p => {
            const isActive = p.isActive;
            const colorClass = isActive ? PERSONA_ACTIVE_COLORS[p.name] ?? "border-primary bg-primary/10" : PERSONA_COLORS[p.name] ?? "border-border/30";
            const glowClass = PERSONA_GLOW[p.name] ?? "text-primary";
            return (
              <Card key={p.id}
                className={`relative border-2 bg-card/40 backdrop-blur-sm transition-all duration-300 ${colorClass}`}
                data-testid={`card-persona-${p.id}`}>
                {isActive && (
                  <div className="absolute top-3 right-3 flex items-center gap-1 font-mono text-[9px] uppercase text-primary tracking-widest">
                    <Check className="w-3 h-3" /> {t("active")}
                  </div>
                )}
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className={`text-5xl leading-none ${glowClass}`}>{p.symbol}</span>
                    <div>
                      <h3 className={`font-display text-xl font-bold uppercase tracking-widest ${glowClass}`}>{p.name}</h3>
                      <p className="font-mono text-[10px] text-muted-foreground/70 uppercase tracking-wider mt-1">{p.emphasis}</p>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/70 font-sans leading-relaxed">{p.description}</p>
                  <div className="space-y-1.5 pt-1">
                    <div className="flex gap-2 text-[10px] font-mono">
                      <span className="text-muted-foreground/60 uppercase w-24 shrink-0">{t("memoryBias")}</span>
                      <span className="text-foreground/60">{p.memoryBias}</span>
                    </div>
                    <div className="flex gap-2 text-[10px] font-mono">
                      <span className="text-muted-foreground/60 uppercase w-24 shrink-0">{t("reasoning")}</span>
                      <span className="text-foreground/60">{p.reasoningStyle}</span>
                    </div>
                  </div>
                  {!isActive && (
                    <Button size="sm" variant="outline" onClick={() => handleActivate(p.id, p.name)}
                      disabled={setActive.isPending}
                      className={`w-full font-mono text-xs uppercase tracking-wider border-current ${glowClass} hover:bg-current/10`}
                      data-testid={`button-activate-${p.id}`}>
                      {t("activateForm")}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
