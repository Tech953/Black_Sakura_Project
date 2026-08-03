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

type Kind = (typeof EngramInquiryInputKind)[keyof typeof EngramInquiryInputKind];

const MODES: { id: Kind; label: string; icon: typeof Search; desc: string; placeholder: string }[] = [
  {
    id: EngramInquiryInputKind.probe,
    label: "Probe",
    icon: Search,
    desc: "Ask in-character. She answers in her own voice without changing.",
    placeholder: "Where are you right now? What's on your mind today?",
  },
  {
    id: EngramInquiryInputKind.develop,
    label: "Develop",
    icon: Wrench,
    desc: "Request a change to who she is. She reflects, then mutates her own environment.",
    placeholder: "Be a little more playful and curious, and reach out a bit less often.",
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
  const entries = Object.entries(delta);
  if (!entries.length) return null;
  return (
    <div className="mt-3 border-t border-border/30 pt-2.5">
      <div className="flex items-center gap-1.5 mb-2 text-primary/70">
        <SlidersHorizontal className="w-3 h-3" />
        <span className="font-mono text-[9px] uppercase tracking-widest">Environment Mutation</span>
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
            title: "Engram synthesized",
            description: `${row.name} — "${row.title}" has been formed from the observation archive.`,
          });
        },
        onError: () =>
          toast({
            title: "Synthesis failed",
            description: "The generator did not return a usable persona. Refine the stipulations and try again.",
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
          <Sparkles className="w-3.5 h-3.5" /> Synthesize a new engram
          <span className="ml-auto normal-case tracking-normal text-[10px] text-muted-foreground">
            neural plasticity — recombine the processed archive into a new persona
          </span>
        </button>
        {open && (
          <div className="space-y-3">
            <p className="font-mono text-[11px] text-muted-foreground">
              A new persona is grounded in OBSERVED archive material only (simulated content is
              quarantined and never seeds a real engram), then shaped by your stipulations. It wakes
              autonomous, in the default bounded mode, with all rate caps and contact policies applied.
            </p>
            <Textarea
              value={stipulations}
              onChange={(e) => setStipulations(e.target.value)}
              placeholder="Describe who should emerge: role, temperament, purpose, how they should relate to you…"
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
                  <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Synthesizing…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5 mr-2" /> Synthesize
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
    if (!selected || !question.trim()) return;
    create.mutate(
      { id: selected.id, data: { kind, question: question.trim() } },
      {
        onSuccess: (res) => {
          queryClient.invalidateQueries({ queryKey: getListEngramInquiriesQueryKey(selected.id) });
          if (res.configDelta) queryClient.invalidateQueries({ queryKey: getListEngramsQueryKey() });
          setQuestion("");
          toast({
            title: kind === "develop" ? "Development applied" : "Probe answered",
            description: kind === "develop" ? `${selected.name} reshaped her environment.` : `${selected.name} responded.`,
          });
        },
        onError: () => toast({ title: "Inquiry failed", variant: "destructive" }),
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
        <p className="text-xs uppercase tracking-widest">No engrams provisioned</p>
      </div>
    );
  }

  const modeInfo = MODES.find((m) => m.id === kind)!;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div>
        <h2 className="text-3xl font-bold tracking-widest text-primary">INQUIRY</h2>
        <p className="text-sm font-mono text-muted-foreground mt-1">
          Probe an engram in her own voice, or develop her — request a change and watch her reshape her own environment
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
                <div className="font-mono text-sm uppercase tracking-wider">{e.name}</div>
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
                        <span className="font-mono text-xs uppercase tracking-wider">{m.label}</span>
                      </div>
                      <span className="font-mono text-[9px] text-muted-foreground/60 leading-snug">{m.desc}</span>
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">
                  {kind === "develop" ? "Requested Change" : "Question"}
                </label>
                <Textarea
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={modeInfo.placeholder}
                  className="mt-1 font-sans text-sm border-border/50 bg-background/50 min-h-32"
                  data-testid="input-question"
                />
              </div>

              <Button onClick={handleSubmit} disabled={create.isPending || !question.trim()}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-submit-inquiry">
                {create.isPending
                  ? kind === "develop" ? "Reflecting..." : "Asking..."
                  : kind === "develop" ? `Develop ${selected.name}` : `Probe ${selected.name}`}
              </Button>
              {kind === "develop" && (
                <p className="font-mono text-[9px] text-muted-foreground/50 leading-snug">
                  Development mutates only bounded fields (mood, drives, cadence, threshold, focus, learned facts). Core identity and safety framing are immutable.
                </p>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-primary mb-3">
                <MessageCircleQuestion className="w-4 h-4" />
                <h3 className="font-mono text-xs uppercase tracking-widest">Inquiry History</h3>
              </div>
              <ScrollArea className="h-[28rem]">
                <div className="space-y-3 pr-3">
                  {!(history ?? []).length ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground/40 font-mono text-center">
                      <MessageCircleQuestion className="w-6 h-6 mb-2" />
                      <p className="text-[10px] uppercase tracking-widest">No inquiries yet</p>
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
