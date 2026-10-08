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