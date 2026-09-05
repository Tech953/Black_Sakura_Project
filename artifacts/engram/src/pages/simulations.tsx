import { useMemo, useState } from "react";
import {
  useListSimulations,
  useListSimulationSteps,
  useControlSimulation,
  useCreateSimulation,
  useListEngrams,
  getListSimulationsQueryKey,
  getListSimulationStepsQueryKey,
  type Simulation,
  type SimulationStep,
  type SimulationControlInputAction,
  type Engram,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FlaskConical,
  Play,
  Pause,
  Square,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  ScrollText,
  Loader2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

const STATUS_META: Record<string, { statusKey: string; cls: string; pulse?: boolean }> = {
  proposed: { statusKey: "proposed", cls: "border-amber-500/40 text-amber-400" },
  running: { statusKey: "running", cls: "border-emerald-500/40 text-emerald-400", pulse: true },
  paused: { statusKey: "paused", cls: "border-sky-500/40 text-sky-400" },
  ended: { statusKey: "ended", cls: "border-border/60 text-muted-foreground" },
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return i18n.t("simulations:relativeTime.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return i18n.t("simulations:relativeTime.minutesAgo", { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return i18n.t("simulations:relativeTime.hoursAgo", { count: hr });
  return i18n.t("simulations:relativeTime.daysAgo", { count: Math.round(hr / 24) });
}

export default function Simulations() {
  const { t } = useTranslation("simulations");
  const { data: simulations, isLoading, isError, refetch } = useListSimulations(undefined, {
    query: {
      queryKey: getListSimulationsQueryKey(),
      refetchInterval: 15000,
    },
  });
  const { data: engrams } = useListEngrams();

  const engramById = useMemo(() => {
    const m = new Map<number, Engram>();
    for (const e of engrams ?? []) m.set(e.id, e);
    return m;
  }, [engrams]);

  const ordered = useMemo(
    () =>
      [...(simulations ?? [])].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      ),
    [simulations],
  );

  const activeCount = ordered.filter((s) => s.status === "running").length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-rose-400 flex items-center gap-3">
            <FlaskConical className="w-7 h-7" /> {t("title")}
          </h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wider border-rose-500/40 text-rose-400 gap-1.5"
          >
            <FlaskConical className="w-3 h-3" /> {t("simsBadge", { count: ordered.length })}
          </Badge>
          {activeCount > 0 && (
            <Badge
              variant="outline"
              className="font-mono text-[10px] uppercase tracking-wider border-emerald-500/40 text-emerald-400 gap-1.5"
            >
              {t("runningBadge", { count: activeCount })}
            </Badge>
          )}
        </div>
      </div>

      {isError ? (
        <Card className="border-destructive/40 bg-destructive/[0.04]">
          <CardContent className="p-5 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-display text-sm uppercase tracking-wider text-destructive">
                {t("openErrorTitle")}
              </p>
              <p className="font-mono text-xs text-muted-foreground mt-1">
                {t("openError")}
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => refetch()}
              className="font-mono text-xs uppercase tracking-wider"
            >
              {t("retry")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="bg-rose-500/[0.03] border border-rose-500/20 p-4 font-mono text-xs text-muted-foreground space-y-1">
        <p className="text-rose-400/80 flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5" /> {t("quarantineTitle")}
        </p>
        <p>
          {t("quarantineBody")} <span className="text-rose-300/80">{t("quarantineProvenance")}</span> {t("quarantineBodyEnd")}
        </p>
      </div>

      <LaunchSimulationPanel engrams={engrams ?? []} />

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 bg-rose-500/5" />
          ))
        ) : !ordered.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
            <FlaskConical className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyTitle")}</p>
            <p className="text-[10px] mt-2 opacity-60 max-w-sm">
              {t("emptyBody")}
            </p>
          </div>
        ) : (
          ordered.map((sim) => (
            <SimulationCard key={sim.id} sim={sim} engram={engramById.get(sim.engramId)} />
          ))
        )}
      </div>
    </div>
  );
}

function LaunchSimulationPanel({ engrams }: { engrams: Engram[] }) {
  const { t } = useTranslation("simulations");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createSim = useCreateSimulation();
  const [engramId, setEngramId] = useState<number | null>(null);
  const [premise, setPremise] = useState("");

  const selectedId = engramId ?? engrams[0]?.id ?? null;

  function handleLaunch() {
    if (selectedId === null || !premise.trim() || createSim.isPending) return;
    createSim.mutate(
      { data: { engramId: selectedId, premise: premise.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSimulationsQueryKey() });
          setPremise("");
          toast({ title: t("openedTitle"), description: t("openedDescription") });
        },
        onError: (err) => {
          const msg =
            (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            t("openError");
          toast({ title: t("openErrorTitle"), description: msg, variant: "destructive" });
        },
      },
    );
  }

  return (
    <Card className="bg-card/40 border-rose-500/25 bg-rose-500/[0.02] backdrop-blur-sm">
      <CardContent className="p-4 space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-rose-300 flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" /> {t("directTitle")}
        </p>
        <p className="font-mono text-[11px] text-muted-foreground">
          {t("directBody")}
        </p>
        <div className="flex flex-wrap gap-2">
          {engrams.map((e) => (
            <button
              key={e.id}
              onClick={() => setEngramId(e.id)}
              data-testid={`button-sim-engram-${e.id}`}
              className={`px-3 py-1.5 border font-mono text-xs transition-all ${
                e.id === selectedId
                  ? "border-rose-500/60 bg-rose-500/10 text-rose-300"
                  : "border-border/40 text-muted-foreground hover:border-rose-500/30"
              }`}
            >
              {e.symbol} {e.name}
            </button>
          ))}
        </div>
        <Textarea
          value={premise}
          onChange={(e) => setPremise(e.target.value)}
          placeholder={t("premisePlaceholder")}
          className="font-mono text-xs bg-background/40 border-rose-500/30 min-h-[64px]"
          data-testid="input-sim-premise"
        />
        <Button
          onClick={handleLaunch}
          disabled={selectedId === null || !premise.trim() || createSim.isPending}
          data-testid="button-launch-simulation"
          className="bg-rose-600/80 hover:bg-rose-600 text-white font-mono text-xs uppercase tracking-widest"
        >
          {createSim.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> {t("opening")}
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 mr-2" /> {t("launchSimulation")}
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function SimulationCard({ sim, engram }: { sim: Simulation; engram?: Engram }) {
  const { t } = useTranslation("simulations");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);

  const control = useControlSimulation();

  const status = STATUS_META[sim.status] ?? STATUS_META.proposed;
  const ended = sim.status === "ended";
  const progress = sim.maxSteps > 0 ? Math.min(100, Math.round((sim.currentStep / sim.maxSteps) * 100)) : 0;

  const { data: steps, isLoading: stepsLoading } = useListSimulationSteps(sim.id, {
    query: {
      queryKey: getListSimulationStepsQueryKey(sim.id),
      enabled: expanded,
      refetchInterval: expanded && !ended ? 15000 : false,
    },
  });

  function runControl(action: SimulationControlInputAction, labelKey: string) {
    const label = t(`actions.${labelKey}`);
    control.mutate(
      { id: sim.id, data: { action } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSimulationsQueryKey() });
          toast({ title: t("controlSuccess", { label }) });
        },
        onError: () => toast({ title: t("controlError", { label }), variant: "destructive" }),
      },
    );
  }

  return (
    <Card
      className="bg-card/40 border-rose-500/25 bg-rose-500/[0.02] backdrop-blur-sm"
      data-testid={`simulation-${sim.id}`}
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-9 h-9 rounded-none border border-rose-500/30 text-rose-400 flex items-center justify-center">
            <FlaskConical className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-display tracking-wider text-sm text-foreground flex items-center gap-1.5">
                <span className="text-rose-300/90">{engram?.symbol ?? "◇"}</span>
                {engram?.name ?? `Engram #${sim.engramId}`}
              </span>
              <Badge
                variant="outline"
                className="font-mono text-[8px] uppercase tracking-wider border-rose-500/40 text-rose-400"
              >
                {t("simulatedBadge")}
              </Badge>
              <Badge
                variant="outline"
                className={`font-mono text-[8px] uppercase tracking-wider ${status.cls}`}
              >
                {status.pulse && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1" />
                )}
                {t(`status.${status.statusKey}`)}
              </Badge>
              <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
                {relativeTime(sim.updatedAt)}
              </span>
            </div>
            <p className="text-sm leading-relaxed font-sans text-foreground/85">{sim.premise}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
            <span>{t("progress")}</span>
            <span className="text-rose-300/80">
              {t("stepCount", { current: sim.currentStep, max: sim.maxSteps })}
            </span>
          </div>
          <div className="h-1.5 w-full bg-rose-500/10 overflow-hidden">
            <div
              className="h-full bg-rose-400/60 transition-all duration-500"
              style={{ width: `${progress}%` }}
              data-testid={`simulation-progress-${sim.id}`}
            />
          </div>
        </div>

        {/* Exit summary */}
        {ended && sim.exitSummary && (
          <div className="border border-rose-500/20 bg-rose-500/[0.04] p-3 space-y-1">
            <p className="font-mono text-[10px] uppercase tracking-wider text-rose-400/80 flex items-center gap-1.5">
              <ScrollText className="w-3 h-3" /> {t("exitSummary")}
            </p>
            <p className="text-sm leading-relaxed font-sans text-foreground/80">{sim.exitSummary}</p>
          </div>
        )}

        {/* Controls + step log toggle */}
        <div className="flex items-center gap-2 flex-wrap">
          {sim.status === "proposed" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runControl("start", "started")}
              disabled={control.isPending}
              className="font-mono text-[10px] uppercase tracking-wider border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 h-8"
              data-testid={`button-start-${sim.id}`}
            >
              <Play className="w-3 h-3 mr-1.5" /> {t("start")}
            </Button>
          )}
          {sim.status === "running" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runControl("pause", "paused")}
              disabled={control.isPending}
              className="font-mono text-[10px] uppercase tracking-wider border-sky-500/40 text-sky-300 hover:bg-sky-500/10 h-8"
              data-testid={`button-pause-${sim.id}`}
            >
              <Pause className="w-3 h-3 mr-1.5" /> {t("pause")}
            </Button>
          )}
          {sim.status === "paused" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runControl("resume", "resumed")}
              disabled={control.isPending}
              className="font-mono text-[10px] uppercase tracking-wider border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10 h-8"
              data-testid={`button-resume-${sim.id}`}
            >
              <Play className="w-3 h-3 mr-1.5" /> {t("resume")}
            </Button>
          )}
          {!ended && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => runControl("end", "ended")}
              disabled={control.isPending}
              className="font-mono text-[10px] uppercase tracking-wider border-rose-500/40 text-rose-300 hover:bg-rose-500/10 h-8"
              data-testid={`button-end-${sim.id}`}
            >
              <Square className="w-3 h-3 mr-1.5" /> {t("end")}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setExpanded((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground h-8 ml-auto"
            data-testid={`button-steps-${sim.id}`}
          >
            {expanded ? <ChevronDown className="w-3 h-3 mr-1.5" /> : <ChevronRight className="w-3 h-3 mr-1.5" />}
            {t("stepLog")}
          </Button>
        </div>

        {/* Step log */}
        {expanded && (
          <div className="border-t border-border/30 pt-3 space-y-2" data-testid={`simulation-steps-${sim.id}`}>
            {stepsLoading ? (
              Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-10 bg-rose-500/5" />)
            ) : !steps?.length ? (
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/50 text-center py-3">
                {t("noStepsYet")}
              </p>
            ) : (
              [...steps]
                .sort((a, b) => a.stepNumber - b.stepNumber)
                .map((step) => <StepRow key={step.id} step={step} />)
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: SimulationStep }) {
  const { t } = useTranslation("simulations");
  return (
    <div className="flex gap-3 items-start" data-testid={`simulation-step-${step.id}`}>
      <div className="shrink-0 w-6 h-6 rounded-none border border-rose-500/25 text-rose-300/80 flex items-center justify-center font-mono text-[10px]">
        {step.stepNumber}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm leading-relaxed font-sans text-foreground/80">{step.narrative}</p>
        <span className="font-mono text-[8px] uppercase tracking-wider text-rose-400/50">
          {t("stepSimulated", { time: relativeTime(step.createdAt) })}
        </span>
      </div>
    </div>
  );
}
