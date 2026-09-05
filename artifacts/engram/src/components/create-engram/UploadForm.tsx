import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileText, Play, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

export interface UploadValues {
  file: File;
  stipulations: string;
}

export function UploadForm({ onSubmit, isUploading }: { onSubmit: (v: UploadValues) => void, isUploading: boolean }) {
  const { t } = useTranslation("createEngram");
  const { toast } = useToast();
  
  const [file, setFile] = useState<File | null>(null);
  const [stipulations, setStipulations] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => setIsDragging(false);
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) setFile(dropped);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast({ variant: "destructive", title: t("errors.errorTitle"), description: t("errors.fileRequired") });
      return;
    }
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast({ variant: "destructive", title: t("errors.errorTitle"), description: t("errors.invalidFileType") });
      return;
    }
    onSubmit({ file, stipulations });
  };

  return (
    <Card className="border-border/50 bg-card/40 backdrop-blur-sm rounded-none">
      <CardHeader>
        <CardTitle className="font-display tracking-widest uppercase">{t("upload.title")}</CardTitle>
        <CardDescription className="font-mono text-xs">{t("upload.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label className="font-mono uppercase text-xs tracking-wider text-primary/70">{t("upload.fileLabel")}</label>
            
            <div 
              className={`relative border-2 border-dashed ${isDragging ? 'border-primary bg-primary/10' : 'border-primary/20 bg-background/50'} transition-all p-6 flex flex-col items-center justify-center gap-3 cursor-pointer h-32 outline-none focus-visible:ring-2 focus-visible:ring-primary/50`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              role="button"
               aria-label={t("upload.dragDrop")}
              tabIndex={0}
              data-testid="dropzone-upload"
            >
              <input 
                type="file" 
                accept=".csv"
                ref={fileInputRef}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setFile(f);
                }}
              />
              
              {file ? (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="text-sm font-mono text-foreground text-center">
                    <span className="text-primary/70">{t("upload.selected")}</span> {file.name}
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="h-6 mt-1 text-xs" onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}>
                    <X className="w-3 h-3 mr-1" /> {t("upload.change")}
                  </Button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-primary/40" />
                  <div className="text-sm font-mono text-primary/70 text-center">
                    {t("upload.dragDrop")}<br/>
                    <span className="text-muted-foreground text-xs">{t("upload.browse")}</span>
                   <span className="block text-muted-foreground/70 text-[10px] mt-1">
                     {t("upload.limit")}
                   </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="font-mono uppercase text-xs tracking-wider text-primary/70">{t("upload.stipulationsLabel")}</label>
            <Textarea 
              placeholder={t("upload.stipulationsPlaceholder")} 
              className="resize-none h-24 bg-background/50 border-primary/20 focus-visible:ring-primary/50 rounded-none font-mono text-sm"
              value={stipulations}
              onChange={e => setStipulations(e.target.value)}
               maxLength={2000}
              data-testid="input-stipulations"
            />
          </div>

          <Button 
            type="submit" 
            disabled={isUploading || !file} 
            className="w-full rounded-none h-12 font-display uppercase tracking-widest text-sm"
            data-testid="button-upload-submit"
          >
            {isUploading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                {t("upload.processing")}
              </>
            ) : (
              <>
                <Play className="w-4 h-4 mr-2 fill-current" />
                {t("upload.button")}
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
