import { useMemo, useState } from "react";
import {
  useListEngrams,
  useListHubSpaces,
  useListHubPresence,
  useListHubActivity,
  useMoveEngramPresence,
  getListHubPresenceQueryKey,
  getListHubActivityQueryKey,
  type HubSpace,
  type EngramPresence,
  type HubActivityEntry,
  type Engram,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Users,
  Home,
  FlaskConical,
  Archive,
  Terminal,
  Moon,
  Globe,
  Eye,
  ShieldCheck,
  ArrowRightLeft,
  LogIn,
  Sunrise,
  Cpu,
  EyeOff,
  MoveRight,
  Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

const KIND_META: Record<string, { icon: typeof Users; accent: string }> = {
  commons: { icon: Users, accent: "text-cyan-400" },
  private_room: { icon: Home, accent: "text-violet-400" },
  simulation_chamber: { icon: FlaskConical, accent: "text-rose-400" },
  archive: { icon: Archive, accent: "text-emerald-400" },
  terminal: { icon: Terminal, accent: "text-amber-400" },
  quiescence: { icon: Moon, accent: "text-indigo-400" },
};

const VISIBILITY_META: Record<string, { icon: typeof Globe }> = {
  public: { icon: Globe },
  occupants: { icon: Eye },
  operators: { icon: ShieldCheck },
};

const ACTIVITY_META: Record<string, { icon: typeof LogIn; color: string }> = {
  enter: { icon: LogIn, color: "text-cyan-400" },
  move: { icon: ArrowRightLeft, color: "text-violet-400" },
  rest: { icon: Moon, color: "text-indigo-400" },
  wake: { icon: Sunrise, color: "text-amber-400" },
  system: { icon: Cpu, color: "text-muted-foreground" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { icon: Globe, accent: "text-primary" };
}

function kindLabel(t: TFunction, kind: string): string {
  return KIND_META[kind] ? t(`kind.${kind}`) : kind;
}

function visibilityLabel(t: TFunction, scope: string): string {
  return VISIBILITY_META[scope] ? t(`visibility.${scope}`) : t("visibility.public");
}

function relativeTime(t: TFunction, iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diff / 1000);
  if (sec < 60) return t("time.justNow");
  const min = Math.round(sec / 60);
  if (min < 60) return t("time.minutesAgo", { count: min });
  const hr = Math.round(min / 60);
  if (hr < 24) return t("time.hoursAgo", { count: hr });
  return t("time.daysAgo", { count: Math.round(hr / 24) });
}

export default function Hub() {
  const { data: engrams, isLoading: engramsLoading } = useListEngrams();
  const { data: spaces, isLoading: spacesLoading } = useListHubSpaces();
  const { data: presence, isLoading: presenceLoading } = useListHubPresence();
  const { data: activity, isLoading: activityLoading } = useListHubActivity({ limit: 30 });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("hub");
  const move = useMoveEngramPresence();

  const [open, setOpen] = useState(false);
  const [moveEngramId, setMoveEngramId] = useState<string>("");
  const [moveSpaceId, setMoveSpaceId] = useState<string>("");
  const [moveNote, setMoveNote] = useState("");

  const engramById = useMemo(() => {
    const m = new Map<number, Engram>();
    for (const e of engrams ?? []) m.set(e.id, e);
    return m;
  }, [engrams]);

  const presenceBySpace = useMemo(() => {
    const m = new Map<number, EngramPresence[]>();
    for (const p of presence ?? []) {
      const list = m.get(p.spaceId) ?? [];
      list.push(p);
      m.set(p.spaceId, list);
    }
    return m;
  }, [presence]);

  const orderedSpaces = useMemo(
    () => [...(spaces ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [spaces],
  );

  function handleMove() {
    const engramId = Number(moveEngramId);
    const spaceId = Number(moveSpaceId);
    if (!engramId || !spaceId) return;
    move.mutate(
      { engramId, data: { spaceId, note: moveNote.trim() || undefined } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListHubPresenceQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListHubActivityQueryKey() });
          const eName = engramById.get(engramId)?.name ?? t("fallbackEngram");
          const sName = (spaces ?? []).find((s) => s.id === spaceId)?.name ?? t("fallbackSpace");
          toast({ title: t("toastPresenceUpdatedTitle"), description: t("toastPresenceUpdatedDescription", { engram: eName, space: sName }) });
          setOpen(false);
          setMoveNote("");
        },
        onError: () => toast({ title: t("toastMoveFailed"), variant: "destructive" }),
      },
    );
  }

  const loading = engramsLoading || spacesLoading || presenceLoading;

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 bg-primary/5" />
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44 bg-primary/5" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">
            {t("subtitle")}
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground"
              disabled={!engrams?.length}
              data-testid="button-relocate"
            >
              <MoveRight className="w-3 h-3 mr-2" /> {t("relocateEngram")}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display tracking-widest text-primary">{t("relocateEngram")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t("engramLabel")}</span>
                <Select value={moveEngramId} onValueChange={setMoveEngramId}>
                  <SelectTrigger className="font-mono text-sm border-border/50 bg-background/50" data-testid="select-move-engram">
                    <SelectValue placeholder={t("chooseEngram")} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border/50">
                    {(engrams ?? []).map((e) => (
                      <SelectItem key={e.id} value={String(e.id)} className="font-mono text-xs">
                        {e.symbol} {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t("destinationSpaceLabel")}</span>
                <Select value={moveSpaceId} onValueChange={setMoveSpaceId}>
                  <SelectTrigger className="font-mono text-sm border-border/50 bg-background/50" data-testid="select-move-space">
                    <SelectValue placeholder={t("chooseSpace")} />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border/50">
                    {orderedSpaces.map((s) => (
                      <SelectItem key={s.id} value={String(s.id)} className="font-mono text-xs">
                        {kindLabel(t, s.kind)} — {s.name}
                        {!s.allowsInitiative ? t("restSuffix") : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t("noteOptionalLabel")}</span>
                <Input
                  value={moveNote}
                  onChange={(e) => setMoveNote(e.target.value)}
                  placeholder={t("notePlaceholder")}
                  className="font-mono text-sm border-border/50 bg-background/50"
                  data-testid="input-move-note"
                />
              </div>
              <Button
                onClick={handleMove}
                disabled={move.isPending || !moveEngramId || !moveSpaceId}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground"
                data-testid="button-confirm-move"
              >
                {move.isPending ? t("moving") : t("move")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Spaces */}
        <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2 content-start">
          {orderedSpaces.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              occupants={presenceBySpace.get(space.id) ?? []}
              engramById={engramById}
            />
          ))}
        </div>

        {/* Activity feed */}
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="font-display uppercase tracking-widest text-sm text-primary">{t("recentActivity")}</h3>
          </div>
          <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
            <CardContent className="p-3">
              {activityLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 bg-primary/5" />
                  ))}
                </div>
              ) : !activity?.length ? (
                <p className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-widest text-center py-8">
                  {t("noMovements")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {activity.map((entry) => (
                    <ActivityRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SpaceCard({
  space,
  occupants,
  engramById,
}: {
  space: HubSpace;
  occupants: EngramPresence[];
  engramById: Map<number, Engram>;
}) {
  const { t } = useTranslation("hub");
  const meta = kindMeta(space.kind);
  const Icon = meta.icon;
  const vis = VISIBILITY_META[space.visibilityScope] ?? VISIBILITY_META.public;
  const VisIcon = vis.icon;

  return (
    <Card
      className="bg-card/40 border-border/50 backdrop-blur-sm flex flex-col"
      data-testid={`card-space-${space.slug}`}
    >
      <CardContent className="p-4 flex flex-col gap-3 flex-1">
        <div className="flex items-start gap-3">
          <div className={`shrink-0 w-9 h-9 rounded-none border border-border/50 flex items-center justify-center ${meta.accent}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-display tracking-wider text-sm text-foreground truncate">{space.name}</h3>
              {!space.allowsInitiative && (
                <Badge variant="outline" className="font-mono text-[8px] uppercase tracking-wider border-indigo-400/40 text-indigo-300 gap-1">
                  <Moon className="w-2.5 h-2.5" /> {t("restBadge")}
                </Badge>
              )}
            </div>
            <span className={`font-mono text-[10px] uppercase tracking-widest ${meta.accent}`}>{kindLabel(t, space.kind)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground/80 leading-relaxed font-sans line-clamp-3">{space.description}</p>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Badge variant="outline" className="font-mono text-[8px] uppercase tracking-wider border-border/50 text-muted-foreground gap-1">
            <VisIcon className="w-2.5 h-2.5" /> {visibilityLabel(t, space.visibilityScope)}
          </Badge>
          <Badge variant="outline" className="font-mono text-[8px] uppercase tracking-wider border-border/50 text-muted-foreground">
            {space.actionScope}
          </Badge>
          <Badge
            variant="outline"
            className={`font-mono text-[8px] uppercase tracking-wider border-border/50 gap-1 ${space.logged ? "text-emerald-400/80" : "text-muted-foreground/50"}`}
          >
            {space.logged ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
            {space.logged ? t("logged") : t("unlogged")}
          </Badge>
        </div>

        <div className="mt-auto pt-2 border-t border-border/30">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">{t("present")}</span>
            <span className="font-mono text-[9px] text-muted-foreground/60">{occupants.length}</span>
          </div>
          {occupants.length === 0 ? (
            <span className="font-mono text-[10px] text-muted-foreground/40 italic">{t("empty")}</span>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {occupants.map((p) => {
                const e = engramById.get(p.engramId);
                const resting = p.status === "resting";
                return (
                  <span
                    key={p.id}
                    title={p.note ?? undefined}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 border font-mono text-[10px] ${
                      resting
                        ? "border-indigo-400/30 text-indigo-300/80 bg-indigo-400/5"
                        : "border-primary/30 text-primary/90 bg-primary/5"
                    }`}
                    data-testid={`occupant-${p.engramId}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${resting ? "bg-indigo-400/70" : "bg-primary animate-pulse"}`} />
                    <span>{e?.symbol ?? "◇"}</span>
                    <span className="truncate max-w-[7rem]">{e?.name ?? `#${p.engramId}`}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ActivityRow({ entry }: { entry: HubActivityEntry }) {
  const { t } = useTranslation("hub");
  const meta = ACTIVITY_META[entry.kind] ?? ACTIVITY_META.system;
  const Icon = meta.icon;
  return (
    <li className="flex items-start gap-2.5 px-2 py-2 hover:bg-white/5 transition-colors" data-testid={`activity-${entry.id}`}>
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${meta.color}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground/80 leading-snug font-sans break-words">{entry.summary}</p>
        <span className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-wider">{relativeTime(t, entry.createdAt)}</span>
      </div>
    </li>
  );
}
