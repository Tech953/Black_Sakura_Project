/**
 * i18n runtime for the ENGRAM web app.
 *
 * UI language:    localStorage "engram.uiLang"   (default "en")
 * Reply language: localStorage "engram.replyLang" — "match" (follow UI language,
 *                 default), "auto" (model matches whatever the user writes), or
 *                 an explicit language code.
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { resources, NAMESPACES, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES, languageInfo } from "@workspace/i18n";

const UI_LANG_KEY = "engram.uiLang";
const REPLY_LANG_KEY = "engram.replyLang";

export function getStoredUiLanguage(): string {
  const stored = localStorage.getItem(UI_LANG_KEY);
  return stored && SUPPORTED_LANGUAGE_CODES.includes(stored) ? stored : DEFAULT_LANGUAGE;
}

function applyDirection(lang: string) {
  document.documentElement.dir = languageInfo(lang)?.rtl ? "rtl" : "ltr";
  document.documentElement.lang = lang;
}

export function setUiLanguage(lang: string) {
  localStorage.setItem(UI_LANG_KEY, lang);
  void i18n.changeLanguage(lang);
  applyDirection(lang);
}

export type ReplyLanguageSetting = "match" | "auto" | string;

export function getReplyLanguageSetting(): ReplyLanguageSetting {
  return localStorage.getItem(REPLY_LANG_KEY) ?? "match";
}

export function setReplyLanguageSetting(value: ReplyLanguageSetting) {
  localStorage.setItem(REPLY_LANG_KEY, value);
}

/**
 * The language code to send with chat/inquiry requests, or undefined for
 * automatic (model matches the user's language).
 */
export function resolveReplyLanguage(): string | undefined {
  const setting = getReplyLanguageSetting();
  if (setting === "auto") return undefined;
  if (setting === "match") return i18n.language || getStoredUiLanguage();
  return SUPPORTED_LANGUAGE_CODES.includes(setting) ? setting : undefined;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: getStoredUiLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  ns: NAMESPACES,
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});
applyDirection(getStoredUiLanguage());

export default i18n;
