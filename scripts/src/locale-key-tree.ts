import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Tree = Record<string, unknown>;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DEFAULT_ENGLISH_LOCALE_DIR = path.join(repoRoot, "lib/i18n/src/en");
export const DEFAULT_GENERATED_LOCALE_DIR = path.join(
  repoRoot,
  "lib/i18n/src/generated",
);

export const TRACKED_MOBILE_FALLBACK_KEYS = [
  "tabs.hub",
  "hub.kicker",
  "hub.title",
  "hub.subtitle",
  "hub.telemetry",
  "hub.live",
  "hub.paused",
  "hub.quiet",
  "hub.ready",
  "hub.waiting",
  "hub.noMood",
  "hub.spaces",
  "hub.occupants",
  "hub.activity",
  "hub.noActivity",
  "hub.unknownSpace",
  "hub.connectionLost",
  "hub.connectionLostSubtitle",
  "detail.memory",
  "detail.noMemory",
  "detail.mediaMemory",
  "detail.noMediaMemory",
  "detail.searchMediaMemory",
  "detail.clearMediaMemorySearch",
  "detail.noMediaMemoryMatches",
  "detail.openMediaSource",
  "detail.beliefs",
  "detail.noBeliefs",
  "detail.confident",
  "detail.revisions",
  "detail.environment",
  "detail.openEnvironment",
  "environment.title",
  "environment.subtitle",
  "environment.liveState",
  "environment.autonomyOn",
  "environment.autonomyOff",
  "environment.topCharge",
  "environment.threshold",
  "environment.cooldown",
  "environment.backoff",
  "environment.ready",
  "environment.waiting",
  "environment.anchor",
  "environment.drives",
  "environment.unavailable",
  "environment.unavailableSubtitle",
] as const;

const ALLOWLISTED_PRODUCT_TERMS = ["ENGRAM", "PYRI", "Hub", "engram"] as const;
const PRODUCT_TERM_PATTERN = new RegExp(
  `\\b(?:${ALLOWLISTED_PRODUCT_TERMS.join("|")})\\b`,
  "giu",
);

export function loadEnglish(
  englishDir = DEFAULT_ENGLISH_LOCALE_DIR,
): Record<string, Tree> {
  const out: Record<string, Tree> = {};
  for (const file of readdirSync(englishDir)
    .filter((name) => name.endsWith(".json"))
    .sort()) {
    out[file.replace(/\.json$/, "")] = JSON.parse(
      readFileSync(path.join(englishDir, file), "utf8"),
    ) as Tree;
  }
  return out;
}

function getStringAtPath(tree: unknown, path: string): string | undefined {
  let value = tree;
  for (const segment of path.split(".")) {
    if (!isTree(value)) return undefined;
    value = value[segment];
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeLocaleText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function normalizeInstallMarkerText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u200e\u200f\u061c\u202a-\u202e\u2066-\u2069]/gu, "")
    .replace(/[\u2018\u2019\u02bc]/gu, "'")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

interface InstallGuidanceMarker {
  key: string;
  label: string;
  terms: readonly string[];
}

const REQUIRED_INSTALL_GUIDANCE_MARKERS: readonly InstallGuidanceMarker[] = [
  { key: "installMac", label: "Gatekeeper warning", terms: ["Gatekeeper"] },
  {
    key: "requirementsMac",
    label: "Apple Silicon and Intel support",
    terms: ["Apple Silicon", "Intel"],
  },
  { key: "installWin", label: ".exe installer", terms: [".exe"] },
  { key: "installWin", label: "SmartScreen warning", terms: ["SmartScreen"] },
  {
    key: "requirementsWin",
    label: "64-bit Windows 10/11 requirements",
    terms: ["64", "Windows", "10", "11"],
  },
  { key: "installLinux", label: "chmod +x command", terms: ["chmod +x"] },
  { key: "installLinux", label: ".deb package", terms: [".deb"] },
  { key: "installLinux", label: "FUSE fallback", terms: ["FUSE"] },
  {
    key: "requirementsLinux",
    label: "64-bit Linux and .deb requirements",
    terms: ["64", "Linux", ".deb"],
  },
  { key: "installAndroid", label: "APK installer", terms: ["APK"] },
  {
    key: "requirementsAndroid",
    label: "Android 8 and APK requirements",
    terms: ["Android", "8", "APK"],
  },
];

type SafetyMarkerName =
  | "macRecovery"
  | "macUnsignedWarning"
  | "macOptionalSigning"
  | "windowsUnsignedWarning"
  | "windowsMoreInfo"
  | "windowsRunAnyway"
  | "windowsOptionalSigning"
  | "androidSideload"
  | "androidReleaseSigning"
  | "androidSigningNotGuaranteed";

const SAFETY_MARKER_LABELS: Record<SafetyMarkerName, string> = {
  macRecovery: "right-click/Open recovery steps",
  macUnsignedWarning: "unsigned/unnotarized-build warning",
  macOptionalSigning: "optional signing/notarization note",
  windowsUnsignedWarning: "unsigned-build SmartScreen warning",
  windowsMoreInfo: "More info action",
  windowsRunAnyway: "run confirmation action",
  windowsOptionalSigning: "optional code-signing note",
  androidSideload: "APK sideloading note",
  androidReleaseSigning: "release-signing note",
  androidSigningNotGuaranteed: "not-guaranteed signing warning",
};

const SAFETY_MARKERS_BY_LANGUAGE: Record<
  string,
  Record<SafetyMarkerName, readonly string[]>
> = {
  en: {
    macRecovery: ["right-click", "choose open"],
    macUnsignedWarning: ["unsigned", "unnotarized", "warning"],
    macOptionalSigning: ["signing", "notarization", "opt-in"],
    windowsUnsignedWarning: ["unsigned", "smartscreen"],
    windowsMoreInfo: ["more info"],
    windowsRunAnyway: ["run anyway"],
    windowsOptionalSigning: ["code signing", "opt-in"],
    androidSideload: ["sideloaded"],
    androidReleaseSigning: ["release signing"],
    androidSigningNotGuaranteed: ["not guaranteed"],
  },
  ar: {
    macRecovery: ["بزر الماوس الأيمن", "فتح"],
    macUnsignedWarning: ["غير الموقعة", "غير الموثقة", "التحذير"],
    macOptionalSigning: ["التوقيع", "التوثيق", "اختياري"],
    windowsUnsignedWarning: ["غير موقع", "smartscreen"],
    windowsMoreInfo: ["مزيد من المعلومات"],
    windowsRunAnyway: ["التشغيل على أي حال"],
    windowsOptionalSigning: ["توقيع التعليمات البرمجية", "اختياري"],
    androidSideload: ["جانبيًا"],
    androidReleaseSigning: ["توقيع الإصدار"],
    androidSigningNotGuaranteed: ["لا يضمن"],
  },
  de: {
    macRecovery: ["mit der rechten maustaste", "öffnen"],
    macUnsignedWarning: ["unsignierte", "nicht notar", "warnung"],
    macOptionalSigning: ["signierung", "notarisierung", "optional"],
    windowsUnsignedWarning: ["unsignierten", "smartscreen"],
    windowsMoreInfo: ["weitere informationen"],
    windowsRunAnyway: ["trotzdem ausführen"],
    windowsOptionalSigning: ["codesignierung", "optional"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["signierung der veröffentlichung"],
    androidSigningNotGuaranteed: ["nicht für jeden build garantiert"],
  },
  es: {
    macRecovery: ["clic derecho", "abrir"],
    macUnsignedWarning: ["sin firma", "sin notarizar", "aviso"],
    macOptionalSigning: ["firma", "notarizacion", "opcional"],
    windowsUnsignedWarning: ["sin firma", "smartscreen"],
    windowsMoreInfo: ["mas informacion"],
    windowsRunAnyway: ["ejecutar de todas formas"],
    windowsOptionalSigning: ["firma de codigo", "opcional"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["firma de lanzamiento"],
    androidSigningNotGuaranteed: ["no esta garantizada"],
  },
  fr: {
    macRecovery: ["clic droit", "ouvrir"],
    macUnsignedWarning: ["non signe", "non notaris", "avertissement"],
    macOptionalSigning: ["signature", "notarisation", "facultatives"],
    windowsUnsignedWarning: ["non signe", "smartscreen"],
    windowsMoreInfo: ["plus d'informations"],
    windowsRunAnyway: ["executer quand meme"],
    windowsOptionalSigning: ["signature de code", "facultative"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["signature de publication"],
    androidSigningNotGuaranteed: ["pas garantie"],
  },
  hi: {
    macRecovery: ["राइट-क्लिक", "open"],
    macUnsignedWarning: ["बिना साइन", "बिना नोटराइज़", "चेतावनी"],
    macOptionalSigning: ["साइनिंग", "नोटराइज़ेशन", "वैकल्पिक"],
    windowsUnsignedWarning: ["बिना साइन किए गए", "smartscreen"],
    windowsMoreInfo: ["more info"],
    windowsRunAnyway: ["run anyway"],
    windowsOptionalSigning: ["कोड साइनिंग", "वैकल्पिक"],
    androidSideload: ["साइडलोड"],
    androidReleaseSigning: ["रिलीज़ साइनिंग"],
    androidSigningNotGuaranteed: ["गारंटी नहीं"],
  },
  it: {
    macRecovery: ["clic destro", "apri"],
    macUnsignedWarning: ["non firmate", "non notarizz", "avviso"],
    macOptionalSigning: ["firma", "notarizzazione", "facoltative"],
    windowsUnsignedWarning: ["non firmata", "smartscreen"],
    windowsMoreInfo: ["altre informazioni"],
    windowsRunAnyway: ["esegui comunque"],
    windowsOptionalSigning: ["firma del codice", "facoltativa"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["firma della release"],
    androidSigningNotGuaranteed: ["non è garantita"],
  },
  ja: {
    macRecovery: ["右クリック", "開く"],
    macUnsignedWarning: ["署名または公証のない", "警告"],
    macOptionalSigning: ["署名", "公証", "任意"],
    windowsUnsignedWarning: ["署名のない", "smartscreen"],
    windowsMoreInfo: ["詳細情報"],
    windowsRunAnyway: ["実行"],
    windowsOptionalSigning: ["コード署名", "任意"],
    androidSideload: ["サイドロード"],
    androidReleaseSigning: ["リリース署名"],
    androidSigningNotGuaranteed: ["保証されるわけではありません"],
  },
  ko: {
    macRecovery: ["오른쪽 버튼", "열기"],
    macUnsignedWarning: ["서명되지 않", "공증되지 않은", "경고"],
    macOptionalSigning: ["서명", "공증", "선택 사항"],
    windowsUnsignedWarning: ["서명되지 않은", "smartscreen"],
    windowsMoreInfo: ["추가 정보"],
    windowsRunAnyway: ["그래도 실행"],
    windowsOptionalSigning: ["코드 서명", "선택 사항"],
    androidSideload: ["사이드로드"],
    androidReleaseSigning: ["릴리스 서명"],
    androidSigningNotGuaranteed: ["보장되지는 않"],
  },
  pt: {
    macRecovery: ["botão direito", "abrir"],
    macUnsignedWarning: ["sem assinatura", "sem notariza", "aviso"],
    macOptionalSigning: ["assinatura", "notarização", "opcionais"],
    windowsUnsignedWarning: ["sem assinatura", "smartscreen"],
    windowsMoreInfo: ["mais informações"],
    windowsRunAnyway: ["executar assim mesmo"],
    windowsOptionalSigning: ["assinatura de código", "opcional"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["assinatura de lançamento"],
    androidSigningNotGuaranteed: ["não é garantida"],
  },
  ru: {
    macRecovery: ["правой кнопкой", "откройте"],
    macUnsignedWarning: ["неподписан", "ненотариз", "предупреждение"],
    macOptionalSigning: ["подпись", "нотариальная заверка", "необязательны"],
    windowsUnsignedWarning: ["неподписанной", "smartscreen"],
    windowsMoreInfo: ["подробнее"],
    windowsRunAnyway: ["выполнить в любом случае"],
    windowsOptionalSigning: ["подпись кода", "необязательна"],
    androidSideload: ["sideload"],
    androidReleaseSigning: ["подпись выпуска"],
    androidSigningNotGuaranteed: ["не гарантируется"],
  },
  zh: {
    macRecovery: ["右键点击", "打开"],
    macUnsignedWarning: ["未签名", "未公证", "警告"],
    macOptionalSigning: ["签名", "公证", "可选"],
    windowsUnsignedWarning: ["未签名的", "smartscreen"],
    windowsMoreInfo: ["更多信息"],
    windowsRunAnyway: ["仍要运行"],
    windowsOptionalSigning: ["代码签名", "可选"],
    androidSideload: ["侧载"],
    androidReleaseSigning: ["发布签名"],
    androidSigningNotGuaranteed: ["不一定保证"],
  },
};

const SAFETY_MARKER_RULES: readonly {
  key: string;
  marker: SafetyMarkerName;
}[] = [
  { key: "installMac", marker: "macRecovery" },
  { key: "installMac", marker: "macUnsignedWarning" },
  { key: "installMac", marker: "macOptionalSigning" },
  { key: "installWin", marker: "windowsUnsignedWarning" },
  { key: "installWin", marker: "windowsMoreInfo" },
  { key: "installWin", marker: "windowsRunAnyway" },
  { key: "installWin", marker: "windowsOptionalSigning" },
  { key: "installAndroid", marker: "androidSideload" },
  { key: "installAndroid", marker: "androidReleaseSigning" },
  { key: "installAndroid", marker: "androidSigningNotGuaranteed" },
];

/**
 * Verify installer strings retain operational markers and platform safety
 * instructions. Safety phrases are localized explicitly so the check remains
 * offline and does not depend on a translation provider.
 */
export function findMissingInstallGuidanceMarkers(
  languageCode: string,
  download: unknown,
): string[] {
  const missing: string[] = [];
  const missingKeys = new Set<string>();
  const profile = SAFETY_MARKERS_BY_LANGUAGE[languageCode];
  const rules = [
    ...REQUIRED_INSTALL_GUIDANCE_MARKERS,
    ...(profile
      ? SAFETY_MARKER_RULES.map(({ key, marker }) => ({
          key,
          label: SAFETY_MARKER_LABELS[marker],
          terms: profile[marker],
        }))
      : []),
  ];

  for (const rule of rules) {
    if (missingKeys.has(rule.key)) continue;
    const value = getStringAtPath(download, rule.key);
    if (value === undefined) {
      missing.push(`download.${rule.key}: string value missing`);
      missingKeys.add(rule.key);
      continue;
    }

    const normalizedValue = normalizeInstallMarkerText(value);
    const missingTerms = rule.terms.filter((term) => {
      const normalizedTerm = normalizeInstallMarkerText(term);
      return !normalizedValue.includes(normalizedTerm);
    });
    if (missingTerms.length > 0) {
      missing.push(`download.${rule.key}: missing ${rule.label}`);
    }
  }

  if (!profile) {
    missing.push(
      `download.installMac: no safety marker profile configured for locale "${languageCode}"`,
    );
  }

  return missing;
}

function hasTranslatableCopy(value: string): boolean {
  const withoutPlaceholders = normalizeLocaleText(value).replace(
    /\{\{[^}]+\}\}/gu,
    " ",
  );
  const withoutProductTerms = withoutPlaceholders.replace(
    PRODUCT_TERM_PATTERN,
    " ",
  );
  return /\p{L}/u.test(withoutProductTerms);
}

/**
 * Find English fallback values only for the explicitly tracked mobile labels.
 * Product-only strings are permitted, but a sentence containing a product term
 * is still reported when its translatable copy remains English.
 */
export function findEnglishFallbackKeys(
  englishMobile: unknown,
  generatedMobile: unknown,
  keyPaths: readonly string[] = TRACKED_MOBILE_FALLBACK_KEYS,
): string[] {
  return keyPaths.filter((keyPath) => {
    const englishValue = getStringAtPath(englishMobile, keyPath);
    const generatedValue = getStringAtPath(generatedMobile, keyPath);
    if (englishValue === undefined || generatedValue === undefined) return false;

    return (
      normalizeLocaleText(englishValue) === normalizeLocaleText(generatedValue) &&
      hasTranslatableCopy(englishValue)
    );
  });
}

export interface KeyTreeDiff {
  missing: string[];
  extra: string[];
  typeMismatches: string[];
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function isTree(value: unknown): value is Tree {
  return valueType(value) === "object";
}

export function diffKeyTrees(
  expected: unknown,
  actual: unknown,
  prefix = "",
): KeyTreeDiff {
  const result: KeyTreeDiff = {
    missing: [],
    extra: [],
    typeMismatches: [],
  };
  const expectedIsTree = isTree(expected);
  const actualIsTree = isTree(actual);
  if (expectedIsTree !== actualIsTree) {
    result.typeMismatches.push(
      `${prefix || "<root>"} (expected ${valueType(expected)}, got ${valueType(actual)})`,
    );
    return result;
  }
  if (!expectedIsTree || !actualIsTree) {
    if (valueType(expected) !== valueType(actual)) {
      result.typeMismatches.push(
        `${prefix || "<root>"} (expected ${valueType(expected)}, got ${valueType(actual)})`,
      );
    }
    return result;
  }

  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  const expectedSet = new Set(expectedKeys);
  const actualSet = new Set(actualKeys);

  for (const key of expectedKeys) {
    const keyPath = prefix ? `${prefix}.${key}` : key;
    if (!actualSet.has(key)) {
      result.missing.push(keyPath);
      continue;
    }
    const child = diffKeyTrees(expected[key], actual[key], keyPath);
    result.missing.push(...child.missing);
    result.extra.push(...child.extra);
    result.typeMismatches.push(...child.typeMismatches);
  }
  for (const key of actualKeys) {
    if (!expectedSet.has(key)) {
      result.extra.push(prefix ? `${prefix}.${key}` : key);
    }
  }
  return result;
}

export function keysMatch(expected: unknown, actual: unknown): boolean {
  const diff = diffKeyTrees(expected, actual);
  return (
    diff.missing.length === 0 &&
    diff.extra.length === 0 &&
    diff.typeMismatches.length === 0
  );
}