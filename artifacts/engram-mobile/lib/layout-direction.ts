import { languageInfo } from "@workspace/i18n";

export function isRtlLanguage(language: string | null | undefined): boolean {
  return languageInfo(language)?.rtl === true;
}