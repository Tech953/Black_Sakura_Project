/**
 * i18n runtime for the ENGRAM mobile app.
 *
 * UI language:    AsyncStorage "engram.uiLang"   (default "en")
 * Reply language: AsyncStorage "engram.replyLang" — "match" (follow UI language,
 *                 default), "auto" (model matches whatever the user writes), or
 *                 an explicit language code.
 *
 * Storage is async on native, so i18next initializes synchronously with English
 * and switches to the persisted language once it resolves.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager, Platform } from "react-native";
import {
  resources,
  NAMESPACES,
  DEFAULT_LANGUAGE,
  SUPPORTED_LANGUAGE_CODES,
} from "@workspace/i18n";
import { isRtlLanguage } from "@/lib/layout-direction";

const UI_LANG_KEY = "engram.uiLang";
const REPLY_LANG_KEY = "engram.replyLang";

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LANGUAGE,
  fallbackLng: DEFAULT_LANGUAGE,
  ns: NAMESPACES,
  defaultNS: "mobile",
  interpolation: { escapeValue: false },
  returnEmptyString: false,
  compatibilityJSON: "v4",
});

export type ReplyLanguageSetting = "match" | "auto" | string;

let replyLangCache: ReplyLanguageSetting = "match";
// Bumped on every user selection so a slow hydration read can never clobber a
// newer in-session choice.
let uiLangSelectionVersion = 0;
let replyLangSelectionVersion = 0;

function applyLanguageDirection(lang: string): boolean {
  const rtl = isRtlLanguage(lang);
  if (Platform.OS === "web") {
    if (typeof document !== "undefined") {
      document.documentElement.dir = rtl ? "rtl" : "ltr";
      document.documentElement.lang = lang;
    }
    return false;
  }
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

/**
 * Single coordinated hydration of both persisted language settings.
 * Await this before sending anything that depends on the reply language.
 */
export const i18nReady: Promise<boolean> = Promise.all([
  AsyncStorage.getItem(UI_LANG_KEY),
  AsyncStorage.getItem(REPLY_LANG_KEY),
])
  .then(async ([storedUi, storedReply]) => {
    const hydratedUi =
      storedUi && SUPPORTED_LANGUAGE_CODES.includes(storedUi)
        ? storedUi
        : DEFAULT_LANGUAGE;
    const restartRequired = applyLanguageDirection(hydratedUi);
    if (
      uiLangSelectionVersion === 0 &&
      hydratedUi !== i18n.language
    ) {
      await i18n.changeLanguage(hydratedUi);
    }
    if (replyLangSelectionVersion === 0 && storedReply) {
      replyLangCache = storedReply;
    }
    return restartRequired;
  })
  .catch(() => applyLanguageDirection(DEFAULT_LANGUAGE));

export async function setUiLanguage(lang: string): Promise<boolean> {
  if (!SUPPORTED_LANGUAGE_CODES.includes(lang)) return false;
  uiLangSelectionVersion++;
  try {
    await AsyncStorage.setItem(UI_LANG_KEY, lang);
  } catch {
    // ignore persistence failure; still switch in-memory
  }
  await i18n.changeLanguage(lang);
  return applyLanguageDirection(lang);
}

export async function getReplyLanguageSetting(): Promise<ReplyLanguageSetting> {
  await i18nReady;
  return replyLangCache;
}

export async function setReplyLanguageSetting(value: ReplyLanguageSetting): Promise<void> {
  replyLangSelectionVersion++;
  replyLangCache = value;
  try {
    await AsyncStorage.setItem(REPLY_LANG_KEY, value);
  } catch {
    // ignore
  }
}

/**
 * The language code to send with chat/inquiry requests, or undefined for
 * automatic (model matches the user's language). Await i18nReady (exported
 * above) before the first send; afterwards the cache is authoritative.
 */
export async function resolveReplyLanguage(): Promise<string | undefined> {
  await i18nReady;
  const setting = replyLangCache;
  if (setting === "auto") return undefined;
  if (setting === "match") return i18n.language || DEFAULT_LANGUAGE;
  return SUPPORTED_LANGUAGE_CODES.includes(setting) ? setting : undefined;
}

export default i18n;
