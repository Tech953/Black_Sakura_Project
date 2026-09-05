import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { LANGUAGES } from "@workspace/i18n";
import {
  setUiLanguage,
  getStoredUiLanguage,
  getReplyLanguageSetting,
  setReplyLanguageSetting,
  type ReplyLanguageSetting,
} from "@/i18n";
import { Download, Globe, MessageSquare } from "lucide-react";

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const [uiLang, setUiLang] = useState(getStoredUiLanguage());
  const [replyLang, setReplyLang] = useState<ReplyLanguageSetting>(getReplyLanguageSetting());

  const selectClass =
    "w-full mt-1 bg-background/50 border border-border/50 text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/60";

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-mono text-lg uppercase tracking-widest text-primary" data-testid="text-settings-title">
          {t("title")}
        </h1>
        <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider mt-1">
          {t("subtitle")}
        </p>
      </div>

      <Card className="bg-card/40 border-border/50 backdrop-blur-sm">
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Globe className="w-3.5 h-3.5" />
            {t("languageSection")}
          </div>

          <div>
            <label className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider">
              {t("uiLanguage")}
            </label>
            <select
              value={uiLang}
              onChange={(e) => {
                setUiLang(e.target.value);
                setUiLanguage(e.target.value);
              }}
              className={selectClass}
              data-testid="select-ui-language"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName} ({l.englishName})
                </option>
              ))}
            </select>
            <p className="font-mono text-[10px] text-muted-foreground/60 mt-1">{t("uiLanguageHint")}</p>
          </div>

          <div>
            <label className="flex items-center gap-1.5 font-mono text-[10px] uppercase text-muted-foreground tracking-wider">
              <MessageSquare className="w-3 h-3" />
              {t("replyLanguage")}
            </label>
            <select
              value={replyLang}
              onChange={(e) => {
                setReplyLang(e.target.value);
                setReplyLanguageSetting(e.target.value);
              }}
              className={selectClass}
              data-testid="select-reply-language"
            >
              <option value="match">{t("replyMatchUi")}</option>
              <option value="auto">{t("replyAuto")}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName} ({l.englishName})
                </option>
              ))}
            </select>
            <p className="font-mono text-[10px] text-muted-foreground/60 mt-1">{t("replyLanguageHint")}</p>
          </div>

          <p className="font-mono text-[10px] text-muted-foreground/50">{t("rtlNote")}</p>
        </CardContent>
      </Card>

      <Card className="bg-card/40 border-border/50 backdrop-blur-sm" data-testid="section-custom-gguf">
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Download className="w-3.5 h-3.5" />
            {t("ggufSection")}
          </div>
          <div>
            <h2 className="font-mono text-sm uppercase tracking-wider text-foreground">
              {t("ggufTitle")}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground mt-2 leading-relaxed">
              {t("ggufBody")}
            </p>
          </div>
          <div className="border border-primary/20 bg-primary/5 px-3 py-2.5">
            <p className="font-mono text-[10px] text-primary/90 leading-relaxed">
              {t("ggufDesktopOnly")}
            </p>
          </div>
          <Link
            href="/download"
            className="inline-flex items-center gap-2 border border-primary/50 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/10"
            data-testid="link-custom-gguf-download"
          >
            <Download className="w-3.5 h-3.5" />
            {t("ggufDownloadAction")}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
