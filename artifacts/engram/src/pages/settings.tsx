import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { LANGUAGES } from "@workspace/i18n";
import {
  getStoredLocalServerUrl,
  setUiLanguage,
  getStoredUiLanguage,
  getReplyLanguageSetting,
  setReplyLanguageSetting,
  setStoredLocalServerUrl,
  type ReplyLanguageSetting,
} from "@/i18n";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Globe,
  LoaderCircle,
  MessageSquare,
  RefreshCw,
  Server,
} from "lucide-react";

type LocalServerStatus = "idle" | "checking" | "reachable" | "unavailable";

function normalizeLocalServerUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

async function checkLocalServer(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${url}/api/healthz`, {
      method: "GET",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return (
      typeof body === "object" &&
      body !== null &&
      "status" in body &&
      (body as { status?: unknown }).status === "ok"
    );
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function SettingsPage() {
  const { t } = useTranslation("settings");
  const [uiLang, setUiLang] = useState(getStoredUiLanguage());
  const [replyLang, setReplyLang] = useState<ReplyLanguageSetting>(getReplyLanguageSetting());
  const [localServerUrl, setLocalServerUrl] = useState(
    () => getStoredLocalServerUrl() ?? "",
  );
  const [localServerStatus, setLocalServerStatus] =
    useState<LocalServerStatus>(() =>
      getStoredLocalServerUrl() ? "checking" : "idle",
    );
  const [localServerError, setLocalServerError] = useState<string | null>(null);

  const selectClass =
    "w-full mt-1 bg-background/50 border border-border/50 text-foreground font-mono text-sm px-3 py-2 focus:outline-none focus:border-primary/60";

  const checkConfiguredServer = useCallback(async (value: string) => {
    const normalized = normalizeLocalServerUrl(value);
    if (!normalized) {
      setLocalServerStatus(value.trim() ? "unavailable" : "idle");
      setLocalServerError(value.trim() ? t("localServerInvalid") : null);
      return;
    }
    setLocalServerStatus("checking");
    setLocalServerError(null);
    const reachable = await checkLocalServer(normalized);
    setLocalServerStatus(reachable ? "reachable" : "unavailable");
  }, [t]);

  useEffect(() => {
    const configured = getStoredLocalServerUrl();
    if (configured) void checkConfiguredServer(configured);
  }, [checkConfiguredServer]);

  const saveLocalServer = async () => {
    const trimmed = localServerUrl.trim();
    if (!trimmed) {
      setStoredLocalServerUrl(null);
      setLocalServerUrl("");
      setLocalServerStatus("idle");
      setLocalServerError(null);
      return;
    }
    const normalized = normalizeLocalServerUrl(trimmed);
    if (!normalized) {
      setLocalServerStatus("unavailable");
      setLocalServerError(t("localServerInvalid"));
      return;
    }
    setStoredLocalServerUrl(normalized);
    setLocalServerUrl(normalized);
    await checkConfiguredServer(normalized);
  };

  const statusCopy = {
    idle: {
      label: t("localServerNotConfigured"),
      detail: t("localServerNotConfiguredHint"),
      className: "text-muted-foreground",
    },
    checking: {
      label: t("localServerChecking"),
      detail: t("localServerCheckingHint"),
      className: "text-primary",
    },
    reachable: {
      label: t("localServerReachable"),
      detail: t("localServerReachableHint"),
      className: "text-emerald-400",
    },
    unavailable: {
      label: t("localServerUnavailable"),
      detail: t("localServerUnavailableHint"),
      className: "text-destructive",
    },
  }[localServerStatus];

  const statusIcon =
    localServerStatus === "checking" ? (
      <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
    ) : localServerStatus === "reachable" ? (
      <CheckCircle2 className="w-3.5 h-3.5" />
    ) : localServerStatus === "unavailable" ? (
      <AlertCircle className="w-3.5 h-3.5" />
    ) : (
      <Server className="w-3.5 h-3.5" />
    );

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

      <Card
        className="bg-card/40 border-border/50 backdrop-blur-sm"
        data-testid="section-local-server"
      >
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            <Server className="w-3.5 h-3.5" />
            {t("localServerSection")}
          </div>
          <div>
            <h2 className="font-mono text-sm uppercase tracking-wider text-foreground">
              {t("localServerTitle")}
            </h2>
            <p className="font-mono text-[11px] text-muted-foreground mt-2 leading-relaxed">
              {t("localServerBody")}
            </p>
          </div>
          <div>
            <label
              htmlFor="local-server-url"
              className="font-mono text-[10px] uppercase text-muted-foreground tracking-wider"
            >
              {t("localServerAddress")}
            </label>
            <input
              id="local-server-url"
              type="url"
              value={localServerUrl}
              onChange={(event) => {
                setLocalServerUrl(event.target.value);
                setLocalServerError(null);
                if (!event.target.value.trim()) setLocalServerStatus("idle");
              }}
              placeholder={t("localServerAddressPlaceholder")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={selectClass}
              data-testid="input-local-server-url"
            />
          </div>
          <div
            className={`flex items-start gap-2 font-mono text-[11px] leading-relaxed ${statusCopy.className}`}
            role="status"
            aria-live="polite"
            data-testid="local-server-status"
          >
            {statusIcon}
            <span>
              <strong className="uppercase tracking-wider">{statusCopy.label}</strong>
              <span className="block text-muted-foreground mt-0.5">
                {localServerError ?? statusCopy.detail}
              </span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => void saveLocalServer()}
            disabled={localServerStatus === "checking"}
            className="inline-flex items-center gap-2 border border-primary/50 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="button-check-local-server"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t("localServerCheckAction")}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
