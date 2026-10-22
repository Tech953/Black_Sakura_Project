import { useState } from "react";
import { useListJournalEntries, useCreateJournalEntry, getListJournalEntriesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { BookOpen, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

export default function Journal() {
  const { data: entries, isLoading } = useListJournalEntries();
  const create = useCreateJournalEntry();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("journal");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [form, setForm] = useState({ event: "", confidence: 0.75, reflection: "", actionItems: "", outcome: "" });

  function handleCreate() {
    if (!form.event.trim() || !form.reflection.trim() || !form.actionItems.trim()) return;
    create.mutate({
      data: {
        event: form.event,
        confidence: form.confidence,
        reflection: form.reflection,
        actionItems: form.actionItems,
        outcome: form.outcome || null,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey() });
        setOpen(false);
        setForm({ event: "", confidence: 0.75, reflection: "", actionItems: "", outcome: "" });
        toast({ title: t("toastRecordedTitle"), description: t("toastRecordedDescription") });
      }
    });
  }

  const sorted = entries ? [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) : [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-create-journal">
              <Plus className="w-3 h-3 mr-2" /> {t("newEntry")}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display tracking-widest text-primary">{t("recordJournalEntry")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 mt-2">
              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("eventLabel")}</label>
                <Input value={form.event} onChange={e => setForm(p => ({ ...p, event: e.target.value }))}
                  placeholder={t("eventPlaceholder")} className="mt-1 font-mono text-sm border-border/50 bg-background/50" data-testid="input-journal-event" />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("confidenceLabel")}</label>
                  <span className="font-mono text-xs text-primary">{Math.round(form.confidence * 100)}%</span>
                </div>
                <Slider min={0} max={1} step={0.01} value={[form.confidence]}
                  onValueChange={v => setForm(p => ({ ...p, confidence: v[0] }))} />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("reflectionLabel")}</label>
                <Textarea value={form.reflection} onChange={e => setForm(p => ({ ...p, reflection: e.target.value }))}
                  placeholder={t("reflectionPlaceholder")} className="mt-1 font-mono text-sm border-border/50 bg-background/50 min-h-20" data-testid="input-journal-reflection" />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("actionItemsLabel")}</label>
                <Textarea value={form.actionItems} onChange={e => setForm(p => ({ ...p, actionItems: e.target.value }))}
                  placeholder={t("actionItemsPlaceholder")} className="mt-1 font-mono text-sm border-border/50 bg-background/50 min-h-16" data-testid="input-journal-actions" />
              </div>
              <div>
                <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("outcomeOptionalLabel")}</label>
                <Input value={form.outcome} onChange={e => setForm(p => ({ ...p, outcome: e.target.value }))}
                  placeholder={t("outcomePlaceholder")} className="mt-1 font-mono text-sm border-border/50 bg-background/50" data-testid="input-journal-outcome" />
              </div>
              <Button onClick={handleCreate} disabled={create.isPending || !form.event.trim()}
                className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-confirm-journal">
                {create.isPending ? t("recording") : t("recordEntry")}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 bg-primary/5" />)
        ) : !sorted.length ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
            <BookOpen className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyState")}</p>
          </div>
        ) : (
          sorted.map((entry, idx) => {
            const isExpanded = expanded === entry.id;
            const conf = Math.round(entry.confidence * 100);
            const confColor = conf >= 80 ? "text-emerald-400" : conf >= 60 ? "text-amber-400" : "text-rose-400";
            return (
              <Card key={entry.id} className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors cursor-pointer"
                onClick={() => setExpanded(isExpanded ? null : entry.id)} data-testid={`card-journal-${entry.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 font-mono text-[10px] text-muted-foreground/50 tabular-nums pt-0.5">
                      {sorted.length - idx}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="font-display font-semibold text-sm uppercase tracking-wider text-foreground/90 truncate">{entry.event}</p>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className={`font-mono text-sm font-bold ${confColor}`}>{conf}%</span>
                          {isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        </div>
                      </div>
                      <p className="font-mono text-[10px] text-muted-foreground/60">{new Date(entry.createdAt).toLocaleString()}</p>
                      {isExpanded && (
                        <div className="mt-4 space-y-3 border-t border-border/30 pt-3 animate-in fade-in duration-200">
                          <div>
                            <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">⟡ {t("reflectionLabel")}</span>
                            <p className="mt-1 text-sm text-foreground/80 font-sans leading-relaxed">{entry.reflection}</p>
                          </div>
                          <div>
                            <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">⌘ {t("actionItemsLabel")}</span>
                            <p className="mt-1 text-sm text-foreground/70 font-sans leading-relaxed">{entry.actionItems}</p>
                          </div>
                          {entry.outcome && (
                            <div>
                              <span className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">⟐ {t("outcomeLabel")}</span>
                              <p className="mt-1 text-sm text-muted-foreground font-sans leading-relaxed italic">{entry.outcome}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
