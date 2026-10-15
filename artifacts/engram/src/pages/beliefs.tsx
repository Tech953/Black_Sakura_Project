import { useState } from "react";
import { useListBeliefs, useCreateBelief, useUpdateBelief, useDeleteBelief, getListBeliefsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { Plus, Trash2, Edit3, FileCheck2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

type BeliefForm = { statement: string; confidence: number; evidence: string; counterarguments: string };

export default function Beliefs() {
  const { data: beliefs, isLoading } = useListBeliefs();
  const create = useCreateBelief();
  const update = useUpdateBelief();
  const remove = useDeleteBelief();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("beliefs");
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<BeliefForm>({ statement: "", confidence: 0.75, evidence: "", counterarguments: "" });

  function openCreate() { setForm({ statement: "", confidence: 0.75, evidence: "", counterarguments: "" }); setCreateOpen(true); }
  function openEdit(b: any) {
    setEditId(b.id);
    setForm({ statement: b.statement, confidence: b.confidence, evidence: b.evidence, counterarguments: b.counterarguments ?? "" });
  }
  function closeEdit() { setEditId(null); }

  function handleCreate() {
    if (!form.statement.trim() || !form.evidence.trim()) return;
    create.mutate({ data: { ...form } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeliefsQueryKey() });
        setCreateOpen(false);
        toast({ title: t("toastRegisteredTitle"), description: t("toastRegisteredDescription") });
      }
    });
  }

  function handleUpdate() {
    if (!editId || !form.statement.trim()) return;
    update.mutate({ id: editId, data: { ...form } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeliefsQueryKey() });
        closeEdit();
        toast({ title: t("toastRevisedTitle"), description: t("toastRevisedDescription") });
      }
    });
  }

  function handleDelete(id: number) {
    remove.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListBeliefsQueryKey() });
        toast({ title: t("toastRemovedTitle"), description: t("toastRemovedDescription") });
      }
    });
  }

  function BeliefForm() {
    const conf = Math.round(form.confidence * 100);
    const confColor = conf >= 80 ? "text-emerald-400" : conf >= 60 ? "text-amber-400" : "text-rose-400";
    return (
      <div className="space-y-4 mt-2">
        <div>
          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("statementLabel")}</label>
          <Textarea value={form.statement} onChange={e => setForm(p => ({ ...p, statement: e.target.value }))}
            placeholder={t("statementPlaceholder")} className="mt-1 font-sans text-sm border-border/50 bg-background/50 min-h-20" />
        </div>
        <div className="space-y-2">
          <div className="flex justify-between">
            <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("confidenceLabel")}</label>
            <span className={`font-mono text-sm font-bold ${confColor}`}>{conf}%</span>
          </div>
          <Slider min={0} max={1} step={0.01} value={[form.confidence]}
            onValueChange={v => setForm(p => ({ ...p, confidence: v[0] }))} />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("supportingEvidenceLabel")}</label>
          <Textarea value={form.evidence} onChange={e => setForm(p => ({ ...p, evidence: e.target.value }))}
            placeholder={t("evidencePlaceholder")} className="mt-1 font-mono text-xs border-border/50 bg-background/50 min-h-16" />
        </div>
        <div>
          <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">{t("counterargumentsOptionalLabel")}</label>
          <Textarea value={form.counterarguments} onChange={e => setForm(p => ({ ...p, counterarguments: e.target.value }))}
            placeholder={t("counterargumentsPlaceholder")} className="mt-1 font-mono text-xs border-border/50 bg-background/50 min-h-12" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-widest text-primary">{t("title")}</h2>
          <p className="text-sm font-mono text-muted-foreground mt-1">{t("subtitle")}</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openCreate}
              className="font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground" data-testid="button-create-belief">
              <Plus className="w-3 h-3 mr-2" /> {t("registerBelief")}
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-card border-border/50 max-w-xl">
            <DialogHeader>
              <DialogTitle className="font-display tracking-widest text-primary">{t("registerNewBelief")}</DialogTitle>
            </DialogHeader>
            <BeliefForm />
            <Button onClick={handleCreate} disabled={create.isPending || !form.statement.trim()}
              className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground mt-4" data-testid="button-confirm-belief">
              {create.isPending ? t("registering") : t("register")}
            </Button>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-52 bg-primary/5" />)
        ) : !beliefs?.length ? (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-muted-foreground font-mono text-center">
            <FileCheck2 className="w-8 h-8 mb-4 opacity-30" />
            <p className="text-xs uppercase tracking-widest">{t("emptyState")}</p>
          </div>
        ) : (
          beliefs.map(b => {
            const conf = Math.round(b.confidence * 100);
            const confColor = conf >= 80 ? "text-emerald-400 border-emerald-500/20" : conf >= 60 ? "text-amber-400 border-amber-500/20" : "text-rose-400 border-rose-500/20";
            return (
              <Card key={b.id} className="bg-card/40 border-border/50 backdrop-blur-sm hover:bg-card/60 transition-colors group" data-testid={`card-belief-${b.id}`}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-sans text-sm font-medium leading-relaxed text-foreground/90 flex-1">{b.statement}</p>
                    <div className={`font-mono text-2xl font-bold tabular-nums shrink-0 ${confColor.split(" ")[0]}`}>{conf}%</div>
                  </div>
                  <div className={`h-1 bg-secondary overflow-hidden border-b ${confColor.split(" ")[1]}`}>
                    <div className={`h-full transition-all ${conf >= 80 ? "bg-emerald-400/60" : conf >= 60 ? "bg-amber-400/60" : "bg-rose-400/60"}`} style={{ width: `${conf}%` }} />
                  </div>
                  <div className="space-y-2 text-[11px] font-mono">
                    <div>
                      <span className="text-muted-foreground/60 uppercase">{t("evidence")}</span>
                      <p className="mt-0.5 text-foreground/60 leading-relaxed">{b.evidence}</p>
                    </div>
                    {b.counterarguments && (
                      <div>
                        <span className="text-muted-foreground/60 uppercase">{t("counterarguments")}</span>
                        <p className="mt-0.5 text-foreground/50 leading-relaxed">{b.counterarguments}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between pt-1 border-t border-border/20">
                    <span className="font-mono text-[9px] text-muted-foreground/50 uppercase">{t("revisionMeta", { count: b.revisionCount, lastReviewed: b.lastReviewed })}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(b)} className="text-muted-foreground hover:text-primary transition-colors p-1" data-testid={`button-edit-belief-${b.id}`}>
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(b.id)} className="text-muted-foreground hover:text-destructive transition-colors p-1" data-testid={`button-delete-belief-${b.id}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={editId !== null} onOpenChange={open => !open && closeEdit()}>
        <DialogContent className="bg-card border-border/50 max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display tracking-widest text-primary">{t("reviseBelief")}</DialogTitle>
          </DialogHeader>
          <BeliefForm />
          <Button onClick={handleUpdate} disabled={update.isPending || !form.statement.trim()}
            className="w-full font-mono text-xs uppercase tracking-wider bg-primary text-primary-foreground mt-4" data-testid="button-confirm-belief-update">
            {update.isPending ? t("revising") : t("reviseBelief")}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
