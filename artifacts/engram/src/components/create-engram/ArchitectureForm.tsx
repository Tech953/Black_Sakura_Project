import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrayTextarea } from "./ArrayTextarea";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { EngramImportEditableDraft } from "@workspace/api-client-react";

export function ArchitectureForm({ draft, setDraft }: { draft: EngramImportEditableDraft, setDraft: React.Dispatch<React.SetStateAction<EngramImportEditableDraft>> }) {
  const { t } = useTranslation("createEngram");
  const [isOpen, setIsOpen] = useState(false);

  const addDrive = () => {
    setDraft(d => ({
      ...d,
      drives: [...d.drives, { id: `drv_${Date.now()}`, label: t("preview.actions.newDriveLabel"), description: "", weight: 0.5, baseRate: 0.001 }]
    }));
  };

  const removeDrive = (index: number) => {
    setDraft(d => ({ ...d, drives: d.drives.filter((_, i) => i !== index) }));
  };

  const updateDrive = (
    index: number,
    patch: Partial<EngramImportEditableDraft["drives"][number]>,
  ) => {
    setDraft(d => ({
      ...d,
      drives: d.drives.map((drive, i) =>
        i === index ? { ...drive, ...patch } : drive,
      ),
    }));
  };

  return (
    <section className="space-y-4">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full border border-border/50 bg-card/20"
      >
        <div className="flex items-center justify-between px-4 py-3 bg-background/50 border-b border-border/50">
          <h2 className="text-xl font-display uppercase tracking-widest text-foreground/90">
            {t("preview.sections.architecture")}
          </h2>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-none w-9 h-9 p-0 hover:bg-primary/10 hover:text-primary">
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span className="sr-only">{t("labels.toggleAdvanced")}</span>
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="p-4 space-y-6">
          
          <div className="space-y-6">
            {/* Voice Profile */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.voiceProfile")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.speechStyle")}</label>
                   <Input value={draft.voiceProfile.speechStyle} onChange={e => setDraft(d => ({...d, voiceProfile: {...d.voiceProfile, speechStyle: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.formatting")}</label>
                   <Input value={draft.voiceProfile.formatting} onChange={e => setDraft(d => ({...d, voiceProfile: {...d.voiceProfile, formatting: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2 md:col-span-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.narrationStyle")}</label>
                   <Input value={draft.voiceProfile.narrationStyle} onChange={e => setDraft(d => ({...d, voiceProfile: {...d.voiceProfile, narrationStyle: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.vocabulary")}</label>
                   <ArrayTextarea value={draft.voiceProfile.vocabulary} onChange={v => setDraft(d => ({...d, voiceProfile: {...d.voiceProfile, vocabulary: v}}))} className="text-xs rounded-none h-24" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.sampleLines")}</label>
                   <ArrayTextarea value={draft.voiceProfile.sampleLines} onChange={v => setDraft(d => ({...d, voiceProfile: {...d.voiceProfile, sampleLines: v}}))} className="text-xs rounded-none h-24" />
                </div>
              </div>
            </div>

            {/* Emotional Baseline */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.emotionalBaseline")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.mood")}</label>
                   <Input value={draft.emotionalBaseline.mood} onChange={e => setDraft(d => ({...d, emotionalBaseline: {...d.emotionalBaseline, mood: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.valence")}</label>
                   <Input type="number" step={0.1} min={-1} max={1} value={draft.emotionalBaseline.valence} onChange={e => setDraft(d => ({...d, emotionalBaseline: {...d.emotionalBaseline, valence: Number(e.target.value)}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.arousal")}</label>
                   <Input type="number" step={0.1} min={0} max={1} value={draft.emotionalBaseline.arousal} onChange={e => setDraft(d => ({...d, emotionalBaseline: {...d.emotionalBaseline, arousal: Number(e.target.value)}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.volatility")}</label>
                   <Input type="number" step={0.1} min={0} max={1} value={draft.emotionalBaseline.volatility} onChange={e => setDraft(d => ({...d, emotionalBaseline: {...d.emotionalBaseline, volatility: Number(e.target.value)}}))} className="text-xs rounded-none" />
                </div>
              </div>
            </div>

            {/* Environment Anchor */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.environmentAnchor")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.envName")}</label>
                   <Input value={draft.environmentAnchor.name} onChange={e => setDraft(d => ({...d, environmentAnchor: {...d.environmentAnchor, name: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.envDescription")}</label>
                   <Textarea value={draft.environmentAnchor.description} onChange={e => setDraft(d => ({...d, environmentAnchor: {...d.environmentAnchor, description: e.target.value}}))} className="text-xs rounded-none h-24 resize-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.envAmbient")}</label>
                   <Textarea value={draft.environmentAnchor.ambient} onChange={e => setDraft(d => ({...d, environmentAnchor: {...d.environmentAnchor, ambient: e.target.value}}))} className="text-xs rounded-none h-24 resize-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.envLocations")}</label>
                   <ArrayTextarea value={draft.environmentAnchor.locations} onChange={v => setDraft(d => ({...d, environmentAnchor: {...d.environmentAnchor, locations: v}}))} className="text-xs rounded-none h-24" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.envItems")}</label>
                   <ArrayTextarea value={draft.environmentAnchor.items} onChange={v => setDraft(d => ({...d, environmentAnchor: {...d.environmentAnchor, items: v}}))} className="text-xs rounded-none h-24" />
                </div>
              </div>
            </div>

            {/* Memory Seed */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.memorySeed")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.memRelationship")}</label>
                   <Input value={draft.memorySeed.relationship} onChange={e => setDraft(d => ({...d, memorySeed: {...d.memorySeed, relationship: e.target.value}}))} className="text-xs rounded-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.memSummary")}</label>
                   <Textarea value={draft.memorySeed.summary} onChange={e => setDraft(d => ({...d, memorySeed: {...d.memorySeed, summary: e.target.value}}))} className="text-xs rounded-none h-24 resize-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.memFacts")}</label>
                   <ArrayTextarea value={draft.memorySeed.facts} onChange={v => setDraft(d => ({...d, memorySeed: {...d.memorySeed, facts: v}}))} className="text-xs rounded-none h-24" />
                   <p className="text-[10px] font-mono text-muted-foreground">
                     {t("preview.architectureFields.memFactsHelp")}
                   </p>
                </div>
              </div>
            </div>

            {/* Guardrails */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.guardrails")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.guardFraming")}</label>
                   <Textarea value={draft.guardrails.framing} onChange={e => setDraft(d => ({...d, guardrails: {...d.guardrails, framing: e.target.value}}))} className="text-xs rounded-none h-24 resize-none" />
                </div>
                <div className="space-y-2">
                   <label className="text-xs font-mono uppercase text-muted-foreground">{t("preview.architectureFields.guardBoundaries")}</label>
                   <ArrayTextarea value={draft.guardrails.boundaries} onChange={v => setDraft(d => ({...d, guardrails: {...d.guardrails, boundaries: v}}))} className="text-xs rounded-none h-24" />
                </div>
              </div>
            </div>

            {/* Focus Themes */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.focusThemes")}</h3>
              <div className="space-y-2">
                 <ArrayTextarea value={draft.focusThemes} onChange={v => setDraft(d => ({...d, focusThemes: v}))} className="text-xs rounded-none h-24" />
              </div>
            </div>

            {/* Drives */}
            <div className="p-4 border border-border/50 bg-background/50 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-mono uppercase text-sm text-primary">{t("preview.fields.drives")}</h3>
                <Button type="button" variant="outline" size="sm" onClick={addDrive} className="rounded-none h-8 text-xs font-mono">
                  <Plus className="w-3 h-3 mr-1" /> {t("preview.actions.addDrive")}
                </Button>
              </div>
              <div className="space-y-4">
                {draft.drives.map((drive, i) => (
                  <div key={drive.id || i} className="grid grid-cols-12 gap-3 p-3 border border-border/50 bg-card/20 relative group">
                    <div className="col-span-12 sm:col-span-3 space-y-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">{t("preview.architectureFields.driveId")}</label>
                       <Input value={drive.id} onChange={e => updateDrive(i, { id: e.target.value })} className="h-8 text-xs rounded-none" />
                    </div>
                    <div className="col-span-12 sm:col-span-3 space-y-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">{t("preview.architectureFields.driveLabel")}</label>
                       <Input value={drive.label} onChange={e => updateDrive(i, { label: e.target.value })} className="h-8 text-xs rounded-none" />
                    </div>
                    <div className="col-span-6 sm:col-span-2 space-y-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">{t("preview.architectureFields.driveWeight")}</label>
                       <Input type="number" step={0.1} min={0} max={1} value={drive.weight} onChange={e => updateDrive(i, { weight: Number(e.target.value) })} className="h-8 text-xs rounded-none" />
                    </div>
                    <div className="col-span-6 sm:col-span-2 space-y-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">{t("preview.architectureFields.driveBaseRate")}</label>
                       <Input type="number" step={0.0001} min={0.0001} max={0.01} value={drive.baseRate} onChange={e => updateDrive(i, { baseRate: Number(e.target.value) })} className="h-8 text-xs rounded-none" />
                    </div>
                    <div className="col-span-12 sm:col-span-2 flex items-end">
                      <Button type="button" variant="destructive" size="sm" onClick={() => removeDrive(i)} className="w-full h-8 rounded-none text-xs" title={t("preview.actions.removeDrive")}>
                        <Trash2 className="w-3 h-3 mr-1 sm:mr-0" /> <span className="sm:hidden">{t("preview.actions.removeDrive")}</span>
                      </Button>
                    </div>
                    <div className="col-span-12 space-y-2">
                      <label className="text-[10px] font-mono uppercase text-muted-foreground">{t("preview.architectureFields.driveDesc")}</label>
                       <Input value={drive.description} onChange={e => updateDrive(i, { description: e.target.value })} className="h-8 text-xs rounded-none" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
