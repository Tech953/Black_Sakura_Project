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