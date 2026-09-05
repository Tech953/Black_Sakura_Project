import { useState, useEffect, useMemo } from "react";
import {
  useListEngrams,
  useCreateEngramInquiry,
  useListEngramInquiries,
  useSynthesizeEngram,
  getListEngramInquiriesQueryKey,
  getListEngramsQueryKey,
} from "@workspace/api-client-react";
import { EngramInquiryInputKind } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircleQuestion, Wrench, Search, Globe, SlidersHorizontal, Sparkles, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { resolveReplyLanguage } from "@/i18n";

type Kind = (typeof EngramInquiryInputKind)[keyof typeof EngramInquiryInputKind];

const MODES: { id: Kind; labelKey: string; icon: typeof Search; descKey: string; placeholderKey: string }[] = [
  {
    id: EngramInquiryInputKind.probe,
    labelKey: "probeLabel",
    icon: Search,
    descKey: "probeDesc",
    placeholderKey: "probePlaceholder",
  },
  {
    id: EngramInquiryInputKind.develop,
    labelKey: "developLabel",
    icon: Wrench,
    descKey: "developDesc",
    placeholderKey: "developPlaceholder",
  },
];

function formatDeltaValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (Array.isArray(v)) return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  return String(v);
}

function ConfigDelta({ delta }: { delta: Record<string, unknown> }) {
  const { t } = useTranslation("inquiry");
  const entries = Object.entries(delta);
  if (!entries.length) return null;
  return (
    <div className="mt-3 border-t border-border/30 pt-2.5">
      <div className="flex items-center gap-1.5 mb-2 text-primary/70">
        <SlidersHorizontal className="w-3 h-3" />
        <span className="font-mono text-[9px] uppercase tracking-widest">{t("environmentMutation")}</span>
      </div>
      <div className="space-y-1">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-start gap-2 font-mono text-[10px]">
            <span className="text-muted-foreground/60 uppercase shrink-0 min-w-[88px] sm:min-w-[120px]">{k}</span>
            <span className="text-foreground/80 break-all">{formatDeltaValue(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SynthesizePanel() {
  const { t } = useTranslation("inquiry");
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const synthesize = useSynthesizeEngram();
  const [open, setOpen] = useState(false);
  const [stipulations, setStipulations] = useState("");

  function handleSynthesize() {
    if (!stipulations.trim() || synthesize.isPending) return;
    synthesize.mutate(
      { data: { stipulations: stipulations.trim() } },
      {
        onSuccess: (row) => {
          queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          setStipulations("");
          toast({
            title: t("engramSynthesized"),
            description: t("engramSynthesizedDesc", { name: row.name, title: row.title }),
          });
        },
        onError: () =>
          toast({
            title: t("synthesisFailed"),
            description: t("synthesisFailedDesc"),
            variant: "destructive",
          }),
      },
    );
  }

  return (
    <Card className="bg-card/40 border-violet-500/25 bg-violet-500/[0.02] backdrop-blur-sm">
      <CardContent className="p-4 space-y-3">
        <button
          onClick={() => setOpen((v) => !v)}
          data-testid="button-toggle-synthesize"
          className="flex items-center gap-2 text-violet-300 font-mono text-xs uppercase tracking-widest w-full"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <Sparkles className="w-3.5 h-3.5" /> {t("synthesizeNewEngram")}
          <span className="ml-auto normal-case tracking-normal text-[10px] text-muted-foreground">
            {t("synthesizeTagline")}
          </span>
        </button>
        {open && (
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              {t("synthesizeExplainer")}
            </p>
            <Textarea
              value={stipulations}
              onChange={(e) => setStipulations(e.target.value)}
              placeholder={t("synthesizePlaceholder")}
              className="font-mono text-xs bg-background/40 border-violet-500/30 min-h-[80px]"
              data-testid="input-synthesize-stipulations"
            />
            <Button
              onClick={handleSynthesize}
              disabled={!stipulations.trim() || synthesize.isPending}
              data-testid="button-synthesize"
              className="bg-violet-600/80 hover:bg-violet-600 text-white font-mono text-xs uppercase tracking-widest"
            >
              {synthesize.isPending ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> {t("synthesizing")}
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-2" /> {t("synthesize")}
                </>
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Inquiry() {
  const { t } = useTranslation("inquiry");
  const { data: engrams, isLoading } = useListEngrams();
  const create = useCreateEngramInquiry();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kind, setKind] = useState<Kind>(EngramInquiryInputKind.probe);
  const [question, setQuestion] = useState("");

  const selected = useMemo(
    () => (engrams ?? []).find((e) => e.id === selectedId) ?? null,
    [engrams, selectedId],
  );

  useEffect(() => {
    if (selectedId !== null || !engrams?.length) return;
    const active = engrams.find((e) => e.isChatActive);
    setSelectedId(active?.id ?? engrams[0].id);
  }, [engrams, selectedId]);

  const { data: history } = useListEngramInquiries(selectedId ?? 0, {
    query: {
      enabled: selectedId !== null,
      queryKey: getListEngramInquiriesQueryKey(selectedId ?? 0),
    },
  });

  function handleSubmit() {
    // Archival branches are immutable, including their inquiry history. Keep
    // the client aligned with the server guard instead of submitting a request
    // that will always return 403.
    if (!selected || selected.isArchival || !question.trim()) return;
    create.mutate(
      { id: selected.id, data: { kind, question: question.trim(), language: resolveReplyLanguage() } },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListEngramInquiriesQueryKey(selected.id) });
          if (res.configDelta) queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          setQuestion("");
          toast({
            title: kind === "develop" ? t("developmentApplied") : t("probeAnswered"),
            description: kind === "develop" ? t("developmentAppliedDesc", { name: selected.name }) : t("probeAnsweredDesc", { name: selected.name }),
          });
        },
        onError: () => toast({ title: t("inquiryFailed"), variant: "destructive" }),
      },
    );
  }

  if (isLoading) {
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
        <p className="text-xs uppercase tracking-widest">{t("noEngramsProvisioned")}</p>
      </div>
    );
  }

  const modeInfo = MODES.find((m) => m.id === kind)!;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">{t("heading")}</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">
          {t("subtitle")}
        </p>
      </div>

      <SynthesizePanel />

      {/* Engram selector */}
      <div className="flex flex-wrap gap-2">
        {engrams.map((e) => {
          const isSel = e.id === selectedId;
          return (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              data-testid={`button-select-engram-${e.id}`}
              className={`flex items-center gap-3 px-4 py-2.5 border transition-all ${
                isSel
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
              }`}
            >
              <span className="text-xl">{e.symbol}</span>
              <div className="text-left">
                <div className="font-mono text-sm uppercase tracking-wider">
                  {e.name}
                  {e.isArchival && <span className="ml-2 text-[9px] text-amber-400/90">{t("archivalBadge")}</span>}
                </div>
                <div className="font-mono text-[9px] text-muted-foreground/60 uppercase">{e.title}</div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Composer */}
          <Card className="bg-card/40 border-border/50 backdrop-blur-sm h-fit">
            <CardContent className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => {
                  const isSel = m.id === kind;
                  return (
                    <button
                      key={m.id}
                      onClick={() => setKind(m.id)}
                      data-testid={`button-mode-${m.id}`}
                      className={`flex flex-col items-start gap-1 px-3 py-2.5 border transition-all text-left ${
                        isSel
                          ? "border-primary/60 bg-primary/10 text-primary"
                          : "border-border/40 text-muted-foreground hover:border-primary/30 hover:text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <m.icon className="w-3.5 h-3.5" />
                        <span className="font-mono text-xs uppercase tracking-wider">{t(m.labelKey)}</span>
                      </div>
                      <span className="font-mono text-[9px] text-muted-foreground/60 leading-snug">{t(m.descKey)}</span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">
                  {kind === "develop" ? t("requestedChange") : t("question")}
                </label>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={t(modeInfo.placeholderKey)}
                  className="mt-1 font-sans text-sm border-border/50 bg-background/50 min-h-32"
                  data-testid="input-question"
                />
              </div>

              {selected.isArchival && (
                <p className="font-mono text-[10px] text-amber-400/80 uppercase tracking-wider">
                  {t("archivalNote")}
                </p>
              )}
              <Button onClick={handleSubmit} disabled={create.isPending || !question.trim() || selected.isArchival}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-submit-inquiry">
                {create.isPending
                  ? kind === "develop" ? t("reflecting") : t("asking")
                  : kind === "develop" ? t("developName", { name: selected.name }) : t("probeName", { name: selected.name })}
              </Button>
              {kind === "develop" && (
                <p className="font-mono text-[9px] text-muted-foreground/50 leading-snug">
                  {t("developmentNote")}
                </p>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-primary mb-3">
                <MessageCircleQuestion className="w-4 h-4" />
                <h3 className="font-mono text-xs uppercase tracking-widest">{t("inquiryHistory")}</h3>
              </div>
              <ScrollArea className="h-[28rem]">
                <div className="space-y-3 pr-3">
                  {!(history ?? []).length ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40 font-mono text-center">
                      <MessageCircleQuestion className="w-6 h-6 mb-2" />
                      <p className="text-[10px] uppercase tracking-widest">{t("noInquiriesYet")}</p>
                    </div>
                  ) : (
                    (history ?? []).map((q) => (
                      <div key={q.id} className="border border-border/40 px-3 py-2.5" data-testid={`inquiry-${q.id}`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <Badge variant="outline" className={`font-mono text-[8px] uppercase ${q.kind === "develop" ? "border-amber-500/40 text-amber-400" : "border-primary/30 text-primary/70"}`}>
                            {q.kind}
                          </Badge>
                          <span className="font-mono text-[9px] text-muted-foreground/50">{new Date(q.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="font-mono text-[11px] text-muted-foreground/80 italic mb-2">“{q.question}”</p>
                        <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{q.response}</p>
                        {q.configDelta && Object.keys(q.configDelta).length > 0 && <ConfigDelta delta={q.configDelta} />}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
