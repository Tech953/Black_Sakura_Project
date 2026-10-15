import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EngramImportEditableDraft, EngramImportMemoryCandidateProvenance, EngramImportMemoryCandidate } from "@workspace/api-client-react";
import { ShieldAlert, Check, Trash2 } from "lucide-react";

export function MemoryForm({ draft, setDraft }: { draft: EngramImportEditableDraft, setDraft: React.Dispatch<React.SetStateAction<EngramImportEditableDraft>> }) {
  const { t } = useTranslation("createEngram");

  const updateCandidate = (index: number, updates: Partial<EngramImportMemoryCandidate>) => {
    setDraft(d => ({
      ...d,
      memoryCandidates: d.memoryCandidates.map((candidate, i) => {
        if (i !== index) return candidate;
        const provenanceChanged =
          updates.provenance !== undefined &&
          updates.provenance !== candidate.provenance;
        const contentChanged =
          updates.content !== undefined && updates.content !== candidate.content;
        const verificationInvalidated = provenanceChanged || contentChanged;
        return {
          ...candidate,
          ...updates,
          operatorVerified: verificationInvalidated
            ? false
            : updates.operatorVerified ?? candidate.operatorVerified,
          operatorVerifiedContent: verificationInvalidated
            ? null
            : updates.operatorVerifiedContent ??
              candidate.operatorVerifiedContent,
        };
      }),
    }));
  };

  const removeCandidate = (index: number) => {
    setDraft(d => ({
      ...d,
      memoryCandidates: d.memoryCandidates.filter((_, i) => i !== index)
    }));
  };

  const toggleVerification = (index: number) => {
    setDraft(d => ({
      ...d,
      memoryCandidates: d.memoryCandidates.map((candidate, i) =>
        i === index
          ? candidate.operatorVerified
            ? {
                ...candidate,
                operatorVerified: false,
                operatorVerifiedContent: null,
              }
            : {
                ...candidate,
                operatorVerified: true,
                operatorVerifiedContent: candidate.content,
              }
          : candidate,
      ),
    }));
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <h2 className="text-xl font-display uppercase tracking-widest text-foreground/90">
          {t("preview.sections.memories")}
        </h2>
        <Badge variant="outline" className="rounded-none border-primary/30 font-mono text-primary bg-primary/5">
          {t("preview.itemsCount", { count: draft.memoryCandidates.length })}
        </Badge>
      </div>
      
      <p className="text-sm font-mono text-muted-foreground">{t("preview.memoryDescription")}</p>
      
      <div className="space-y-3">
        {draft.memoryCandidates.length === 0 ? (
          <div className="text-center p-8 border border-dashed border-border/50 text-muted-foreground font-mono text-sm">
            {t("empty.memories")}
          </div>
        ) : (
          draft.memoryCandidates.map((mem, i) => (
            <div 
              key={mem.id} 
              className={`p-4 border ${mem.provenance === EngramImportMemoryCandidateProvenance.remembered ? (mem.operatorVerified ? 'border-primary/50 bg-primary/5' : 'border-destructive/50 bg-destructive/5') : 'border-border/50 bg-card/20'} flex flex-col gap-4 group transition-colors`}
            >
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                  <Select 
                    value={mem.provenance} 
                    onValueChange={(v: EngramImportMemoryCandidateProvenance) => updateCandidate(i, { provenance: v })}
                  >
                    <SelectTrigger className={`w-[140px] h-8 text-xs font-mono rounded-none ${mem.provenance === EngramImportMemoryCandidateProvenance.remembered ? 'border-destructive text-destructive' : ''}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="font-mono text-xs rounded-none">
                      <SelectItem value={EngramImportMemoryCandidateProvenance.simulated}>{t("preview.provenance.simulated")}</SelectItem>
                      <SelectItem value={EngramImportMemoryCandidateProvenance.inferred}>{t("preview.provenance.inferred")}</SelectItem>
                      <SelectItem value={EngramImportMemoryCandidateProvenance.remembered}>{t("preview.provenance.remembered")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-xs font-mono text-muted-foreground">
                    {t("labels.id", { id: mem.id.substring(0, 8) })}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-muted-foreground">
                    {t("labels.rows", {
                      rows:
                        mem.sourceRows.length > 0
                          ? mem.sourceRows.join(", ")
                          : t("labels.notAvailable"),
                    })}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeCandidate(i)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" title={t("preview.actions.removeMemory")}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <Textarea 
                value={mem.content}
                onChange={e => updateCandidate(i, { content: e.target.value })}
                className="font-mono text-sm min-h-[80px] rounded-none bg-background/50 border-border/50 focus-visible:ring-primary/50"
              />
              
              {mem.provenance === EngramImportMemoryCandidateProvenance.remembered && (
                <div className="flex justify-end pt-2 border-t border-border/50">
                  {mem.operatorVerified ? (
                    <Button 
                      type="button"
                      variant="outline" 
                      size="sm" 
                      onClick={() => toggleVerification(i)}
                      className="rounded-none border-primary/50 text-primary bg-primary/10 hover:bg-primary/20 h-9 font-display tracking-wider"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      {t("preview.verified")}
                    </Button>
                  ) : (
                    <Button 
                      type="button"
                      variant="destructive" 
                      size="sm" 
                      onClick={() => toggleVerification(i)}
                      className="rounded-none h-9 font-display tracking-wider hover:bg-destructive/90 glow-box"
                    >
                      <ShieldAlert className="w-4 h-4 mr-2" />
                      {t("preview.verifyRemembered")}
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
