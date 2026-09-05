import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EngramImportEditableDraft } from "@workspace/api-client-react";

export function IdentityForm({ draft, setDraft }: { draft: EngramImportEditableDraft, setDraft: React.Dispatch<React.SetStateAction<EngramImportEditableDraft>> }) {
  const { t } = useTranslation("createEngram");

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-display uppercase tracking-widest border-b border-border/50 pb-2 text-foreground/90">
        {t("preview.sections.identity")}
      </h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.name")}</label>
            <Input 
              value={draft.name}
              onChange={e => setDraft({...draft, name: e.target.value})}
              className="rounded-none bg-background/50 border-border/50 font-mono"
              data-testid="input-draft-name"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.title")}</label>
            <Input 
              value={draft.title}
              onChange={e => setDraft({...draft, title: e.target.value})}
              className="rounded-none bg-background/50 border-border/50 font-mono"
              data-testid="input-draft-title"
            />
          </div>
          
          <div className="space-y-2">
            <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.symbol")}</label>
            <Input 
              value={draft.symbol}
              onChange={e => setDraft({...draft, symbol: e.target.value})}
              maxLength={8}
              className="rounded-none bg-background/50 border-border/50 font-mono w-32 text-center tracking-widest text-lg"
              data-testid="input-draft-symbol"
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <label className="text-xs font-mono uppercase text-primary/70">{t("preview.fields.origin")}</label>
          <Textarea 
            value={draft.origin}
            onChange={e => setDraft({...draft, origin: e.target.value})}
            className="rounded-none bg-background/50 border-border/50 font-mono h-full min-h-[160px] resize-none"
            data-testid="input-draft-origin"
          />
        </div>
      </div>
    </section>
  );
}
