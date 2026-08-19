import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useListMemories, useCreateMemory, useDeleteMemory, getListMemoriesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Trash2, Plus, Database } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const LAYERS = ["working", "episodic", "semantic", "preference", "reflective", "procedural"] as const;
type Layer = (typeof LAYERS)[number];

const LAYER_COLORS: Record<Layer, string> = {
  working: "text-cyan-400",
  episodic: "text-purple-400",
  semantic: "text-emerald-400",
  preference: "text-amber-400",
  reflective: "text-rose-400",
  procedural: "text-sky-400",
};

const LAYER_SYMBOLS: Record<Layer, string> = {
  working: "⌘",
  episodic: "⬡",
  semantic: "◈",
  preference: "◎",
  reflective: "⟡",
  procedural: "△",
};

export default function Memory() {
  const { t } = useTranslation("memory");
  const [activeLayer, setActiveLayer] = useState<Layer | "all">("all");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ layer: "episodic" as Layer, content: "", confidence: 0.75 });
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const params = activeLayer !== "all" ? { layer: activeLayer } : undefined;
  const { data: memories, isLoading } = useListMemories(params, { query: { queryKey: getListMemoriesQueryKey(params) } });
  const createMem = useCreateMemory();
  const deleteMem = useDeleteMemory();

  function handleCreate() {
    if (!form.content.trim()) return;
    createMem.mutate({ data: { layer: form.layer, content: form.content, confidence: form.confidence } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMemoriesQueryKey() });
        setOpen(false);
        setForm({ layer: "episodic", content: "", confidence: 0.75 });
        toast({ title: t("encodedTitle"), description: t("encodedDescription", { layer: form.layer }) });
      }
    });
  }

  function handleDelete(id: number) {
    deleteMem.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMemoriesQueryKey() });
        toast({ title: t("purgedTitle"), description: t("purgedDescription") });
      }
    });
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-create-memory">
              <Plus className="w-3 h-3 mr-2" /> {t("encodeMemory")}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-display tracking-widest text-primary">{t("encodeNewMemory")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <Select value={form.layer} onValueChange={(v) => setForm(p => ({ ...p, layer: v as Layer }))}>
                <SelectTrigger className="font-mono text-sm border-border/50 bg-background/50" data-testid="select-memory-layer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border/50">
                  {LAYERS.map(l => <SelectItem key={l} value={l} className="font-mono uppercase text-xs">{l}</SelectItem>)}
                </SelectContent>
              </Select>
              <Textarea
                placeholder={t("contentPlaceholder")}
                value={form.content}
                onChange={e => setForm(p => ({ ...p, content: e.target.value }))}
                className="font-mono text-sm border-border/50 bg-background/50 min-h-28"
                data-testid="input-memory-content"
              />
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-mono text-muted-foreground">
                  <span>{t("confidence")}</span>
                  <span className="text-primary">{Math.round(form.confidence * 100)}%</span>
                </div>
                <Slider min={0} max={1} step={0.01} value={[form.confidence]}
                  onValueChange={v => setForm(p => ({ ...p, confidence: v[0] }))} />
              </div>
              <Button onClick={handleCreate} disabled={createMem.isPending || !form.content.trim()}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-confirm-memory">
                {createMem.isPending ? t("encoding") : t("encode")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Layer filter tabs */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setActiveLayer("all")}
          className={`font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors ${activeLayer === "all" ? "border-primary text-primary bg-primary/10" : "border-border/50 text-muted-foreground hover:border-primary/50"}`}
          data-testid="filter-all">
          {t("allLayers")}
        </button>
        {LAYERS.map(l => (
          <button key={l} onClick={() => setActiveLayer(l)}
            className={`font-mono text-xs uppercase tracking-wider px-3 py-1.5 border transition-colors flex items-center gap-1.5 ${activeLayer === l ? "border-primary text-primary bg-primary/10" : "border-border/50 text-muted-foreground hover:border-primary/50"}`}
            data-testid={`filter-${l}`}>
            <span>{LAYER_SYMBOLS[l]}</span> {l}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 bg-primary/5" />)
        ) : !memories || memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground font-mono">
            <Database className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyState")}</p>
          </div>
        ) : (
          memories.map(m => (
            <Card key={m.id} className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors group" data-testid={`card-memory-${m.id}`}>
              <CardContent className="p-4 flex gap-4 items-start">
                <span className="text-xl mt-0.5 shrink-0">{LAYER_SYMBOLS[m.layer as Layer]}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <span className={`font-mono text-[10px] uppercase font-bold ${LAYER_COLORS[m.layer as Layer]}`}>{m.layer}</span>
                    <span className="font-mono text-[10px] text-muted-foreground/60">{new Date(m.createdAt).toLocaleDateString()}</span>
                    {m.tags && <span className="font-mono text-[10px] text-muted-foreground/40">{m.tags}</span>}
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed font-sans">{m.content}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1 w-24 bg-secondary overflow-hidden">
                      <div className="h-full bg-primary/60 transition-all" style={{ width: `${m.confidence * 100}%` }} />
                    </div>
                    <span className="font-mono text-[10px] text-primary">{Math.round(m.confidence * 100)}%</span>
                  </div>
                </div>
                <button onClick={() => handleDelete(m.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                  data-testid={`button-delete-memory-${m.id}`}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
