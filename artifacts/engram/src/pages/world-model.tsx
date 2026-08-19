import { useState, useEffect, useMemo } from "react";
import {
  useListEngrams,
  useListEngramWorldModel,
  useCreateEngramWorldModelEntry,
  useDeleteEngramWorldModelEntry,
  getListEngramWorldModelQueryKey,
  WorldModelInputProvenance,
  WorldModelInputScope,
  type WorldModelEntry,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Trash2, Plus, Globe, Eye, GitBranch, Archive, Target, FlaskConical, Lock, Share2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

type Provenance = (typeof WorldModelInputProvenance)[keyof typeof WorldModelInputProvenance];
type Scope = (typeof WorldModelInputScope)[keyof typeof WorldModelInputScope];

const PROVENANCE_ORDER: Provenance[] = ["observed", "inferred", "remembered", "desired", "simulated"];

const PROVENANCE_META: Record<
  Provenance,
  { color: string; bar: string; icon: typeof Eye }
> = {
  observed: { color: "text-cyan-400", bar: "bg-cyan-400", icon: Eye },
  inferred: { color: "text-violet-400", bar: "bg-violet-400", icon: GitBranch },
  remembered: { color: "text-emerald-400", bar: "bg-emerald-400", icon: Archive },
  desired: { color: "text-amber-400", bar: "bg-amber-400", icon: Target },
  simulated: { color: "text-rose-400", bar: "bg-rose-400", icon: FlaskConical },
};

export default function WorldModel() {
  const { data: engrams, isLoading: engramsLoading } = useListEngrams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("worldModel");

  const provLabel = (prov: Provenance) => t(`provenance.${prov}.label`);
  const provBlurb = (prov: Provenance) => t(`provenance.${prov}.blurb`);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ provenance: Provenance; content: string; confidence: number; scope: Scope }>({
    provenance: "observed",
    content: "",
    confidence: 0.7,
    scope: "private",
  });

  useEffect(() => {
    if (selectedId !== null || !engrams?.length) return;
    const active = engrams.find((e) => e.isChatActive);
    setSelectedId(active?.id ?? engrams[0].id);
  }, [engrams, selectedId]);

  const { data: entries, isLoading: entriesLoading } = useListEngramWorldModel(selectedId ?? 0, {
    query: {
      enabled: selectedId !== null,
      queryKey: getListEngramWorldModelQueryKey(selectedId ?? 0),
    },
  });

  const create = useCreateEngramWorldModelEntry();
  const remove = useDeleteEngramWorldModelEntry();

  const grouped = useMemo(() => {
    const map = new Map<Provenance, WorldModelEntry[]>();
    for (const prov of PROVENANCE_ORDER) map.set(prov, []);
    for (const e of entries ?? []) {
      const key = e.provenance as Provenance;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return map;
  }, [entries]);

  const selected = useMemo(
    () => (engrams ?? []).find((e) => e.id === selectedId) ?? null,
    [engrams, selectedId],
  );

  function handleCreate() {
    if (selectedId === null || !form.content.trim()) return;
    create.mutate(
      {
        id: selectedId,
        data: {
          provenance: form.provenance,
          content: form.content.trim(),
          confidence: form.confidence,
          scope: form.scope,
          source: "manual",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramWorldModelQueryKey(selectedId) });
          setOpen(false);
          setForm({ provenance: "observed", content: "", confidence: 0.7, scope: "private" });
          toast({ title: t("toastRecordedTitle"), description: t("toastRecordedDescription", { label: provLabel(form.provenance) }) });
        },
        onError: () => toast({ title: t("toastRecordFailed"), variant: "destructive" }),
      },
    );
  }

  function handleDelete(entryId: number) {
    if (selectedId === null) return;
    remove.mutate(
      { id: selectedId, entryId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListEngramWorldModelQueryKey(selectedId) });
          toast({ title: t("toastRemovedTitle"), description: t("toastRemovedDescription") });
        },
        onError: () => toast({ title: t("toastDeleteFailed"), variant: "destructive" }),
      },
    );
  }

  if (engramsLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-72 bg-primary/5" />
        <Skeleton className="h-64 bg-primary/5" />
      </div>
    );
  }

  if (!engrams?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-foreground font-mono text-center">
        <Globe className="w-8 h-8 mb-4 opacity-30" />
        <p className="text-xs uppercase tracking-widest">{t("noEngrams")}</p>
      </div>
    );
  }

  const total = entries?.length ?? 0;

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
              disabled={selectedId === null}
              data-testid="button-create-entry"
            >
              <Plus className="w-3 h-3 mr-2" /> {t("recordBelief")}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display tracking-widest text-primary">{t("recordWorldModelBelief")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t("provenanceLabel")}</span>
                <Select value={form.provenance} onValueChange={(v) => setForm((p) => ({ ...p, provenance: v as Provenance }))}>
                  <SelectTrigger className="font-mono text-sm border-border/50 bg-background/50" data-testid="select-provenance">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border/50">
                    {PROVENANCE_ORDER.map((prov) => (
                      <SelectItem key={prov} value={prov} className="font-mono uppercase text-xs">
                        {provLabel(prov)} — {provBlurb(prov)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                placeholder={t("contentPlaceholder")}
                value={form.content}
                onChange={(e) => setForm((p) => ({ ...p, content: e.target.value }))}
                className="font-mono text-sm border-border/50 bg-background/50 min-h-28"
                data-testid="input-entry-content"
              />
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-muted-foreground">
                  <span>{t("confidence")}</span>
                  <span className="text-primary">{Math.round(form.confidence * 100)}%</span>
                </div>
                <Slider min={0} max={1} step={0.01} value={[form.confidence]} onValueChange={(v) => setForm((p) => ({ ...p, confidence: v[0] }))} />
              </div>
              <div className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{t("scope")}</span>
                <Select value={form.scope} onValueChange={(v) => setForm((p) => ({ ...p, scope: v as Scope }))}>
                  <SelectTrigger className="font-mono text-sm border-border/50 bg-background/50" data-testid="select-scope">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border/50">
                    <SelectItem value="private" className="font-mono uppercase text-xs">{t("scopePrivate")}</SelectItem>
                    <SelectItem value="shared" className="font-mono uppercase text-xs">{t("scopeShared")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={handleCreate}
                disabled={create.isPending || !form.content.trim()}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground"
                data-testid="button-confirm-entry"
              >
                {create.isPending ? t("recording") : t("record")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Engram selector */}
      <div className="flex gap-2 flex-wrap">
        {engrams.map((e) => (
          <button
            key={e.id}
            onClick={() => setSelectedId(e.id)}
            className={`font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors ${
              selectedId === e.id ? "border-primary text-primary bg-primary/10" : "border-border/50 text-muted-foreground hover:border-primary/50"
            }`}
            data-testid={`select-engram-${e.id}`}
          >
            {e.name}
          </button>
        ))}
      </div>

      {entriesLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 bg-primary/5" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground font-mono">
          <Globe className="w-8 h-8 mb-4 opacity-30" />
          <p className="text-xs uppercase tracking-widest">
            {selected ? t("emptyForEngram", { name: selected.name }) : t("emptyNoBeliefs")}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {PROVENANCE_ORDER.map((prov) => {
            const rows = grouped.get(prov) ?? [];
            if (!rows.length) return null;
            const meta = PROVENANCE_META[prov];
            const Icon = meta.icon;
            return (
              <section key={prov} data-testid={`group-${prov}`}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-4 h-4 ${meta.color}`} />
                  <h3 className={`font-display uppercase tracking-widest text-sm ${meta.color}`}>{provLabel(prov)}</h3>
                  <span className="font-mono text-[10px] text-muted-foreground/60">{provBlurb(prov)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">{rows.length}</span>
                </div>
                <div className="space-y-3">
                  {rows.map((entry) => (
                    <Card
                      key={entry.id}
                      className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors group"
                      data-testid={`card-entry-${entry.id}`}
                    >
                      <CardContent className="p-4 flex gap-4 items-start">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <Badge
                              variant="outline"
                              className={`font-mono text-[9px] uppercase tracking-wider border-border/50 ${meta.color}`}
                            >
                              {provLabel(prov)}
                            </Badge>
                            <Badge variant="outline" className="font-mono text-[9px] uppercase tracking-wider border-border/50 text-muted-foreground gap-1">
                              {entry.scope === "shared" ? <Share2 className="w-2.5 h-2.5" /> : <Lock className="w-2.5 h-2.5" />}
                              {entry.scope}
                            </Badge>
                            {entry.source && (
                              <span className="font-mono text-[10px] text-muted-foreground/40">{entry.source}</span>
                            )}
                            <span className="font-mono text-[10px] text-muted-foreground/40 ml-auto">
                              {new Date(entry.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <p className="text-sm text-foreground/80 leading-relaxed font-sans break-words">{entry.content}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1 w-24 bg-secondary overflow-hidden">
                              <div className={`h-full ${meta.bar} transition-all`} style={{ width: `${entry.confidence * 100}%` }} />
                            </div>
                            <span className="font-mono text-[10px] text-muted-foreground">{t("confidencePercent", { percent: Math.round(entry.confidence * 100) })}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(entry.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                          data-testid={`button-delete-entry-${entry.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
