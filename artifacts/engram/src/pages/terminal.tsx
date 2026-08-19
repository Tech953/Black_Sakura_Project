import { useMemo, useState } from "react";
import {
  useGetHubControls,
  useUpdateHubControls,
  useListEngrams,
  useUpdateEngramConfig,
  useListEngramMessages,
  useMarkEngramMessagesSeen,
  useListHubSpaces,
  useMoveEngramPresence,
  getGetHubControlsQueryKey,
  getListEngramsQueryKey,
  getListEngramMessagesQueryKey,
  getListHubPresenceQueryKey,
  getListHubActivityQueryKey,
  EngramMode,
  type Engram,
  type EngramMessage,
  type EngramMode as EngramModeT,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Terminal as TerminalIcon,
  Pause,
  BellOff,
  Download,
  Moon,
  Check,
  Inbox,
  ShieldAlert,
  Power,
  FlaskConical,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const MODE_META: Record<string, { labelKey: string; cls: string }> = {
  orientation: { labelKey: "modes.orientation", cls: "text-sky-400" },
  social: { labelKey: "modes.social", cls: "text-cyan-400" },
  simulation: { labelKey: "modes.simulation", cls: "text-rose-400" },
  initiative_limited: { labelKey: "modes.initiativeLimited", cls: "text-amber-400" },
  full_bounded: { labelKey: "modes.fullBounded", cls: "text-emerald-400" },
  quiescent: { labelKey: "modes.quiescent", cls: "text-indigo-400" },
};

const MODE_ORDER: EngramModeT[] = [
  EngramMode.orientation,
  EngramMode.social,
  EngramMode.initiative_limited,
  EngramMode.full_bounded,
  EngramMode.simulation,
  EngramMode.quiescent,
];

const STATUS_META: Record<string, { labelKey: string; cls: string }> = {
  delivered: { labelKey: "status.delivered", cls: "border-emerald-500/30 text-emerald-400" },
  queued: { labelKey: "status.queued", cls: "border-amber-500/30 text-amber-400" },
  digest: { labelKey: "status.digest", cls: "border-sky-500/30 text-sky-400" },
  blocked: { labelKey: "status.blocked", cls: "border-rose-500/40 text-rose-400" },
};

const PRIORITY_META: Record<string, { labelKey: string; cls: string }> = {
  urgent: { labelKey: "priority.urgent", cls: "border-rose-500/40 text-rose-400" },
  meaningful: { labelKey: "priority.meaningful", cls: "border-amber-500/30 text-amber-400" },
  social: { labelKey: "priority.social", cls: "border-cyan-500/30 text-cyan-400" },
};

function relativeTime(iso: string, t: TFunction): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("common:justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("minutesAgo", { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("hoursAgo", { count: hr });
  return t("daysAgo", { count: Math.round(hr / 24) });
}

export default function Terminal() {
  const { t } = useTranslation("terminal");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: controls, isLoading: controlsLoading } = useGetHubControls();
  const { data: engrams, isLoading: engramsLoading } = useListEngrams();
  const { data: spaces } = useListHubSpaces();
  const { data: messages, isLoading: messagesLoading } = useListEngramMessages(
    { channel: "human", limit: 100 },
    {
      query: {
        queryKey: getListEngramMessagesQueryKey({ channel: "human", limit: 100 }),
        refetchInterval: 15000,
      },
    },
  );

  const updateControls = useUpdateHubControls();
  const updateEngram = useUpdateEngramConfig();
  const markSeen = useMarkEngramMessagesSeen();
  const move = useMoveEngramPresence();

  const [pendingEngramId, setPendingEngramId] = useState<number | null>(null);

  const humanMessagesKey = getListEngramMessagesQueryKey({ channel: "human", limit: 100 });

  const quiescenceSpace = useMemo(
    () => (spaces ?? []).find((s) => s.kind === "quiescence"),
    [spaces],
  );

  const engramById = useMemo(() => {
    const m = new Map<number, Engram>();
    for (const e of engrams ?? []) m.set(e.id, e);
    return m;
  }, [engrams]);

  const ordered = useMemo(
    () =>
      [...(messages ?? [])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [messages],
  );

  const unseenIds = useMemo(
    () => ordered.filter((m) => !m.seen && m.status !== "blocked").map((m) => m.id),
    [ordered],
  );

  function toggleControl(patch: { paused?: boolean; quietMode?: boolean }) {
    updateControls.mutate(
      { data: patch },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetHubControlsQueryKey() });
        },
        onError: () => toast({ title: t("toastUpdateControlsFailed"), variant: "destructive" }),
      },
    );
  }

  function setEngramMode(engram: Engram, mode: EngramModeT) {
    setPendingEngramId(engram.id);
    updateEngram.mutate(
      { id: engram.id, data: { mode } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          toast({ title: t("toastModeChanged", { name: engram.name, mode: MODE_META[mode] ? t(MODE_META[mode].labelKey) : mode }) });
        },
        onError: () => toast({ title: t("toastChangeModeFailed"), variant: "destructive" }),
        onSettled: () => setPendingEngramId(null),
      },
    );
  }

  function toggleHumanContact(engram: Engram, enabled: boolean) {
    setPendingEngramId(engram.id);
    updateEngram.mutate(
      { id: engram.id, data: { humanContactEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          toast({
            title: t("toastHumanContactChanged", { context: enabled ? "enabled" : "disabled", name: engram.name }),
          });
        },
        onError: () => toast({ title: t("toastUpdateHumanContactFailed"), variant: "destructive" }),
        onSettled: () => setPendingEngramId(null),
      },
    );
  }

  function toggleSimulation(engram: Engram, enabled: boolean) {
    setPendingEngramId(engram.id);
    updateEngram.mutate(
      { id: engram.id, data: { simulationEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          toast({
            title: t("toastSimulationsChanged", { context: enabled ? "enabled" : "disabled", name: engram.name }),
          });
        },
        onError: () => toast({ title: t("toastUpdateSimulationsFailed"), variant: "destructive" }),
        onSettled: () => setPendingEngramId(null),
      },
    );
  }

  function toggleArtifactGeneration(engram: Engram, enabled: boolean) {
    setPendingEngramId(engram.id);
    updateEngram.mutate(
      { id: engram.id, data: { artifactGenerationEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          toast({
            title: t("toastArtifactGenerationChanged", { context: enabled ? "enabled" : "disabled", name: engram.name }),
          });
        },
        onError: () => toast({ title: t("toastUpdateArtifactGenerationFailed"), variant: "destructive" }),
        onSettled: () => setPendingEngramId(null),
      },
    );
  }

  function sendToQuiescence(engram: Engram) {
    if (!quiescenceSpace) {
      toast({ title: t("toastNoQuiescenceSpace"), variant: "destructive" });
      return;
    }
    setPendingEngramId(engram.id);
    move.mutate(
      { engramId: engram.id, data: { spaceId: quiescenceSpace.id, note: t("quiescenceNote") } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListHubPresenceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListHubActivityQueryKey() });
          toast({ title: t("toastSentToQuiescence", { name: engram.name }) });
        },
        onError: () => toast({ title: t("toastSendToQuiescenceFailed"), variant: "destructive" }),
        onSettled: () => setPendingEngramId(null),
      },
    );
  }

  function handleMarkSeen() {
    if (!unseenIds.length) return;
    markSeen.mutate(
      { data: { ids: unseenIds } },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: humanMessagesKey });
          toast({ title: t("toastMarkedSeen", { count: res.updated }) });
        },
        onError: () => toast({ title: t("toastMarkSeenFailed"), variant: "destructive" }),
      },
    );
  }

  function exportLogs() {
    const payload = {
      exportedAt: new Date().toISOString(),
      channel: "human",
      controls: controls ?? null,
      messages: ordered.map((m) => ({
        ...m,
        fromEngram: engramById.get(m.fromEngramId)?.name ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `human-contact-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast({ title: t("toastLogExported"), description: t("toastLogExportedDescription", { count: ordered.length }) });
  }

  const paused = controls?.paused ?? false;
  const quietMode = controls?.quietMode ?? false;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary flex items-center gap-3">
            <TerminalIcon className="w-7 h-7" /> {t("title")}
          </h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={exportLogs}
          disabled={!ordered.length}
          className="font-mono text-xs uppercase tracking-wider border-border/50"
          data-testid="button-export-logs"
        >
          <Download className="w-3 h-3 mr-2" /> {t("exportLogs")}
        </Button>
      </div>

      {/* Global overrides */}
      <div className="grid gap-4 sm:grid-cols-2">
        <ControlToggle
          icon={Pause}
          title={t("globalPauseTitle")}
          description={t("globalPauseDescription")}
          active={paused}
          activeLabel={t("pausedLabel")}
          tone="rose"
          loading={controlsLoading || updateControls.isPending}
          onToggle={(v) => toggleControl({ paused: v })}
          testId="switch-pause"
        />
        <ControlToggle
          icon={BellOff}
          title={t("quietModeTitle")}
          description={t("quietModeDescription")}
          active={quietMode}
          activeLabel={t("quietLabel")}
          tone="amber"
          loading={controlsLoading || updateControls.isPending}
          onToggle={(v) => toggleControl({ quietMode: v })}
          testId="switch-quiet"
        />
      </div>

      {/* Per-engram controls */}
      <div>
        <h3 className="font-display uppercase tracking-widest text-sm text-primary mb-3">
          {t("perEngramControls")}
        </h3>
        {engramsLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 bg-primary/5" />
            ))}
          </div>
        ) : !engrams?.length ? (
          <p className="font-mono text-xs text-muted-foreground/60 uppercase tracking-widest py-6 text-center">
            {t("noEngramsInstantiated")}
          </p>
        ) : (
          <div className="space-y-3">
            {engrams.map((engram) => (
              <Card key={engram.id} className="bg-card/40 border-border/50 backdrop-blur-sm">
                <CardContent className="p-4 flex flex-col lg:flex-row lg:items-center gap-4">
                  <div className="flex items-center gap-3 min-w-0 lg:w-56 shrink-0">
                    <div className="shrink-0 w-9 h-9 rounded-none border border-border/50 flex items-center justify-center text-primary text-lg">
                      {engram.symbol}
                    </div>
                    <div className="min-w-0">
                      <p className="font-display tracking-wider text-sm text-foreground truncate">{engram.name}</p>
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${MODE_META[engram.mode]?.cls ?? "text-muted-foreground"}`}>
                        {MODE_META[engram.mode] ? t(MODE_META[engram.mode].labelKey) : engram.mode}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-wrap items-center gap-4">
                    <div className="space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60 block">{t("modeLabel")}</span>
                      <Select
                        value={engram.mode}
                        onValueChange={(v) => setEngramMode(engram, v as EngramModeT)}
                        disabled={pendingEngramId === engram.id}
                      >
                        <SelectTrigger
                          className="font-mono text-xs border-border/50 bg-background/50 w-52 h-8"
                          data-testid={`select-mode-${engram.id}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-card border-border/50">
                          {MODE_ORDER.map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-xs">
                              {MODE_META[m] ? t(MODE_META[m].labelKey) : m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60 block">{t("humanContact")}</span>
                      <div className="flex items-center gap-2 h-8">
                        <Switch
                          checked={engram.humanContactEnabled}
                          onCheckedChange={(v) => toggleHumanContact(engram, v)}
                          disabled={pendingEngramId === engram.id}
                          data-testid={`switch-human-contact-${engram.id}`}
                        />
                        <span className={`font-mono text-[10px] uppercase tracking-wider ${engram.humanContactEnabled ? "text-emerald-400" : "text-muted-foreground/50"}`}>
                          {engram.humanContactEnabled ? t("common:enabled") : t("common:disabled")}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                        <FlaskConical className="w-2.5 h-2.5" /> {t("simulations")}
                      </span>
                      <div className="flex items-center gap-2 h-8">
                        <Switch
                          checked={engram.simulationEnabled}
                          onCheckedChange={(v) => toggleSimulation(engram, v)}
                          disabled={pendingEngramId === engram.id}
                          data-testid={`switch-simulation-${engram.id}`}
                        />
                        <span className={`font-mono text-[10px] uppercase tracking-wider ${engram.simulationEnabled ? "text-rose-400" : "text-muted-foreground/50"}`}>
                          {engram.simulationEnabled ? t("common:enabled") : t("common:disabled")}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
                        <FileText className="w-2.5 h-2.5" /> {t("generation")}
                      </span>
                      <div className="flex items-center gap-2 h-8">
                        <Switch
                          checked={engram.artifactGenerationEnabled}
                          onCheckedChange={(v) => toggleArtifactGeneration(engram, v)}
                          disabled={pendingEngramId === engram.id}
                          data-testid={`switch-artifact-generation-${engram.id}`}
                        />
                        <span className={`font-mono text-[10px] uppercase tracking-wider ${engram.artifactGenerationEnabled ? "text-amber-400" : "text-muted-foreground/50"}`}>
                          {engram.artifactGenerationEnabled ? t("common:enabled") : t("common:disabled")}
                        </span>
                      </div>
                    </div>

                    <div className="space-y-1 ml-auto">
                      <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60 block">{t("override")}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => sendToQuiescence(engram)}
                        disabled={pendingEngramId === engram.id || !quiescenceSpace || engram.mode === "quiescent"}
                        className="font-mono text-[10px] uppercase tracking-wider border-indigo-400/40 text-indigo-300 hover:bg-indigo-400/10 h-8"
                        data-testid={`button-quiescence-${engram.id}`}
                      >
                        <Moon className="w-3 h-3 mr-1.5" /> {t("sendToQuiescence")}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Human-channel messages */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <h3 className="font-display uppercase tracking-widest text-sm text-primary flex items-center gap-2">
            <Inbox className="w-4 h-4" /> {t("incomingContact")}
            {unseenIds.length > 0 && (
              <Badge variant="outline" className="font-mono text-[9px] uppercase border-primary/40 text-primary">
                {t("newCount", { count: unseenIds.length })}
              </Badge>
            )}
          </h3>
          <Button
            size="sm"
            variant="outline"
            onClick={handleMarkSeen}
            disabled={!unseenIds.length || markSeen.isPending}
            className="font-mono text-xs uppercase tracking-wider border-border/50"
            data-testid="button-mark-seen"
          >
            <Check className="w-3 h-3 mr-2" /> {t("markAllSeen")}
          </Button>
        </div>

        {messagesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 bg-primary/5" />
            ))}
          </div>
        ) : !ordered.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground font-mono text-center">
            <Power className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("noEngramReachedOut")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {ordered.map((msg) => (
              <HumanMessageRow key={msg.id} msg={msg} engramById={engramById} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ControlToggle({
  icon: Icon,
  title,
  description,
  active,
  activeLabel,
  tone,
  loading,
  onToggle,
  testId,
}: {
  icon: typeof Pause;
  title: string;
  description: string;
  active: boolean;
  activeLabel: string;
  tone: "rose" | "amber";
  loading: boolean;
  onToggle: (v: boolean) => void;
  testId: string;
}) {
  const toneCls =
    tone === "rose" ? "border-rose-500/40 text-rose-400" : "border-amber-500/40 text-amber-400";
  return (
    <Card className={`bg-card/40 border-border/50 backdrop-blur-sm ${active ? `${toneCls} bg-white/[0.02]` : ""}`}>
      <CardContent className="p-4 flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-none border flex items-center justify-center ${active ? toneCls : "border-border/50 text-muted-foreground"}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4 className="font-display tracking-wider text-sm text-foreground">{title}</h4>
            {active && (
              <Badge variant="outline" className={`font-mono text-[8px] uppercase tracking-wider ${toneCls}`}>
                {activeLabel}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground/80 leading-relaxed font-sans">{description}</p>
        </div>
        <Switch checked={active} onCheckedChange={onToggle} disabled={loading} data-testid={testId} />
      </CardContent>
    </Card>
  );
}

function HumanMessageRow({
  msg,
  engramById,
}: {
  msg: EngramMessage;
  engramById: Map<number, Engram>;
}) {
  const { t } = useTranslation("terminal");
  const from = engramById.get(msg.fromEngramId);
  const status = STATUS_META[msg.status] ?? STATUS_META.delivered;
  const priority = PRIORITY_META[msg.priority] ?? PRIORITY_META.social;
  const blocked = msg.status === "blocked";
  const unseen = !msg.seen && !blocked;

  return (
    <Card
      className={`bg-card/40 border-border/50 backdrop-blur-sm ${unseen ? "border-primary/30" : ""} ${blocked ? "border-rose-500/30 bg-rose-500/[0.03]" : ""}`}
      data-testid={`human-message-${msg.id}`}
    >
      <CardContent className="p-4 flex gap-3 items-start">
        <div className="shrink-0 w-9 h-9 rounded-none border border-border/50 flex items-center justify-center text-primary text-lg">
          {from?.symbol ?? "◇"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-display tracking-wider text-sm text-foreground">
              {from?.name ?? t("engramFallbackName", { id: msg.fromEngramId })}
            </span>
            <Badge variant="outline" className={`font-mono text-[8px] uppercase tracking-wider ${priority.cls}`}>
              {t(priority.labelKey)}
            </Badge>
            <Badge variant="outline" className={`font-mono text-[8px] uppercase tracking-wider ${status.cls}`}>
              {t(status.labelKey)}
            </Badge>
            {unseen && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" title={t("unseen")} />
            )}
            <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
              {relativeTime(msg.createdAt, t)}
            </span>
          </div>
          <p className={`text-sm leading-relaxed font-sans ${blocked ? "text-rose-200/70 italic" : "text-foreground/85"}`}>
            {msg.content}
          </p>
          {blocked && msg.reason && (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-rose-400/80 flex items-center gap-1.5">
              <ShieldAlert className="w-3 h-3 shrink-0" /> {msg.reason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
