import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { CheckCircle2, AlertTriangle, Cpu, X, RefreshCw } from "lucide-react";

import { useConfirmEngramCsvImport, EngramImportPreview, EngramImportEditableDraft, EngramImportMemoryCandidateProvenance } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

import { UploadForm, UploadValues } from "@/components/create-engram/UploadForm";
import { IdentityForm } from "@/components/create-engram/IdentityForm";
import { BehaviorForm } from "@/components/create-engram/BehaviorForm";
import { ArchitectureForm } from "@/components/create-engram/ArchitectureForm";
import { MemoryForm } from "@/components/create-engram/MemoryForm";

export default function CreateEngram() {
  const { t } = useTranslation("createEngram");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [preview, setPreview] = useState<EngramImportPreview | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  
  const handleUpload = async (values: UploadValues) => {
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", values.file);
      if (values.stipulations) {
        formData.append("stipulations", values.stipulations);
      }

      const response = await fetch("/api/engrams/import-csv/preview", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        let errMessage = t("errors.uploadFailed");
        try {
          const contentType = response.headers.get("content-type");
          if (contentType && contentType.includes("application/json")) {
            const err = await response.json();
            errMessage = err.error || err.message || errMessage;
          } else {
            errMessage = (await response.text()).trim().slice(0, 1000) || errMessage;
          }
        } catch {
          errMessage = t("errors.invalidJson");
        }
        throw new Error(errMessage);
      }

      const data: EngramImportPreview = await response.json();
      setPreview(data);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("errors.errorTitle"),
        description: error instanceof Error ? error.message : t("errors.uploadFailed"),
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
  };

  if (preview) {
    return <DraftEditor preview={preview} onCancel={handleCancel} />;
  }

  return (
    <div className="container max-w-2xl py-12 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-2 text-center items-center">
        <div className="w-16 h-16 rounded-none bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 text-primary glow-box">
          <Cpu className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-display font-bold tracking-widest uppercase text-foreground">
          {t("title")}
        </h1>
        <p className="text-muted-foreground font-mono text-sm max-w-md">
          {t("subtitle")}
        </p>
      </div>

      <UploadForm onSubmit={handleUpload} isUploading={isUploading} />
    </div>
  );
}

function DraftEditor({ 
  preview, 
  onCancel,
}: { 
  preview: EngramImportPreview;
  onCancel: () => void;
}) {
  const { t } = useTranslation("createEngram");
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const confirmMutation = useConfirmEngramCsvImport();
  
  const [draft, setDraft] = useState<EngramImportEditableDraft>(preview.draft);

  const handleSubmit = async () => {
    const unverified = draft.memoryCandidates.some(
      m => m.provenance === EngramImportMemoryCandidateProvenance.remembered && !m.operatorVerified
    );
    
    if (unverified) {
      toast({
        variant: "destructive",
        title: t("errors.verificationRequiredTitle"),
        description: t("errors.unverifiedMemories"),
      });
      return;
    }
    
    try {
      const engram = await confirmMutation.mutateAsync({
        data: {
          draftId: preview.draftId,
          draft: draft
        }
      });
      
      toast({
        title: t("success.title"),
        description: t("success.description", { name: engram.name }),
      });
      
      setLocation(`/hub`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("errors.errorTitle"),
        description: error instanceof Error ? error.message : t("errors.confirmFailed"),
      });
    }
  };

  return (
    <div className="container max-w-5xl py-6 space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-24">
      <div className="flex flex-col gap-2 border-b border-primary/20 pb-4">
        <h1 className="text-3xl font-display font-bold tracking-widest uppercase text-primary glow-text flex items-center gap-3">
          <Cpu className="w-8 h-8" />
          {t("preview.title")}
        </h1>
        <p className="text-muted-foreground font-mono text-sm border-l-2 border-primary/30 pl-3">
          {t("preview.sourceSummary", { filename: preview.source.filename })}<br/>
          {t("preview.sourceStats", { 
            rowsAccepted: preview.source.rowsAccepted, 
            rowsSkipped: preview.source.rowsSkipped, 
            charactersAccepted: preview.source.charactersAccepted 
          })}
        </p>
      </div>

      <div className="bg-primary/5 border border-primary/20 p-3 text-sm font-mono text-primary/90">
        {t("preview.noWriteBoundary")}
      </div>

      {preview.source.warnings.length > 0 && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardHeader className="py-3">
            <CardTitle className="text-sm text-destructive flex items-center gap-2 font-mono uppercase tracking-wider">
              <AlertTriangle className="w-4 h-4" />
              {t("preview.warnings")}
            </CardTitle>
          </CardHeader>
          <CardContent className="py-0 pb-4">
            <ul className="text-sm font-mono text-destructive/80 space-y-1">
              {preview.source.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <span className="opacity-50">{t("labels.code", { code: w.code })}</span>
                  {w.row !== null && <span className="opacity-50">{t("labels.row", { row: w.row })}</span>}
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <IdentityForm draft={draft} setDraft={setDraft} />
      <BehaviorForm draft={draft} setDraft={setDraft} />
      <ArchitectureForm draft={draft} setDraft={setDraft} />
      <MemoryForm draft={draft} setDraft={setDraft} />

      <div className="fixed bottom-0 left-0 md:left-64 right-0 p-4 border-t border-border/50 bg-background/90 backdrop-blur-md z-30 flex items-center justify-between">
        <Button 
          variant="ghost" 
          onClick={onCancel}
          disabled={confirmMutation.isPending}
          className="rounded-none font-display uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4 mr-2" />
          {t("preview.cancel")}
        </Button>
        
        <Button 
          onClick={handleSubmit}
          disabled={confirmMutation.isPending}
          className="rounded-none font-display uppercase tracking-widest bg-primary hover:bg-primary/90 text-primary-foreground px-8 glow-box"
        >
          {confirmMutation.isPending ? (
            <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> {t("preview.confirming")}</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-2" /> {t("preview.confirm")}</>
          )}
        </Button>
      </div>
    </div>
  );
}
