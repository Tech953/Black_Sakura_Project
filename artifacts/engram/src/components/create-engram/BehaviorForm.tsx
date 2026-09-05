import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ShieldAlert } from "lucide-react";
import { EngramImportEditableDraft, EngramImportEditableDraftMode } from "@workspace/api-client-react";

export function BehaviorForm({ draft, setDraft }: { draft: EngramImportEditableDraft, setDraft: React.Dispatch<React.SetStateAction<EngramImportEditableDraft>> }) {
  const { t } = useTranslation("createEngram");

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-display uppercase tracking-widest border-b border-border/50 pb-2 text-foreground/90">
        {t("preview.sections.behavior")}
      </h2>
      
      <div className="bg-primary/5 border border-primary/20 p-4 text-sm font-mono text-primary/80 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
        <p>{t("preview.quiescentWarning")}</p>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 p-6 border border-border/50 bg-card/30">
        <div className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.autonomyEnabled")}</label>
          <Switch 
            checked={draft.autonomyEnabled}
            onCheckedChange={v => setDraft({...draft, autonomyEnabled: v})}
            data-testid="switch-autonomy"
          />
        </div>
        
        <div className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.humanContactEnabled")}</label>
          <Switch 
            checked={draft.humanContactEnabled}
            onCheckedChange={v => setDraft({...draft, humanContactEnabled: v})}
            data-testid="switch-human-contact"
          />
        </div>
        
        <div className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.simulationEnabled")}</label>
          <Switch 
            checked={draft.simulationEnabled}
            onCheckedChange={v => setDraft({...draft, simulationEnabled: v})}
            data-testid="switch-simulation"
          />
        </div>

        <div className="flex flex-col gap-3">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.artifactGenerationEnabled")}</label>
          <Switch 
            checked={draft.artifactGenerationEnabled}
            onCheckedChange={v => setDraft({...draft, artifactGenerationEnabled: v})}
            data-testid="switch-artifact-gen"
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="space-y-2">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.mode")}</label>
          <Select 
            value={draft.mode}
            onValueChange={(v: EngramImportEditableDraftMode) => setDraft({...draft, mode: v})}
          >
            <SelectTrigger className="rounded-none font-mono text-sm bg-background/50 border-border/50" data-testid="select-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-none border-border/50 font-mono text-sm">
              {Object.values(EngramImportEditableDraftMode).map(mode => (
                <SelectItem key={mode} value={mode}>{t(`modes.${mode}`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        <div className="space-y-2">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.tickCadenceSeconds")}</label>
          <Input 
            type="number"
            min={15}
            max={3600}
            value={draft.tickCadenceSeconds}
            onChange={e => setDraft({...draft, tickCadenceSeconds: Number(e.target.value)})}
            className="rounded-none bg-background/50 border-border/50 font-mono"
            data-testid="input-tick-cadence"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.initiationThreshold")}</label>
          <Input 
            type="number"
            min={0.1}
            max={0.95}
            step={0.05}
            value={draft.initiationThreshold}
            onChange={e => setDraft({...draft, initiationThreshold: Number(e.target.value)})}
            className="rounded-none bg-background/50 border-border/50 font-mono"
            data-testid="input-initiation-threshold"
          />
        </div>
      </div>
    </section>
  );
}
