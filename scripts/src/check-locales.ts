/**
 * Verify that every generated locale has exactly the same structural key tree
 * as the merged English namespaces. This check never contacts the translation
 * model and is safe to run in typechecks and CI.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { LANGUAGES } from "@workspace/i18n";
import {
  DEFAULT_ENGLISH_LOCALE_DIR,
  DEFAULT_GENERATED_LOCALE_DIR,
  diffKeyTrees,
  findEnglishFallbackKeys,
  loadEnglish,
  TRACKED_MOBILE_FALLBACK_KEYS,
  type KeyTreeDiff,
  type Tree,
} from "./locale-key-tree.js";

interface LocaleFailure {
  code: string;
  error?: string;
  diff?: KeyTreeDiff;
  englishFallbacks?: string[];
}

const englishDir =
  process.env.I18N_ENGLISH_DIR ?? DEFAULT_ENGLISH_LOCALE_DIR;
const generatedDir =
  process.env.I18N_GENERATED_DIR ?? DEFAULT_GENERATED_LOCALE_DIR;
const english = loadEnglish(englishDir);
const failures: LocaleFailure[] = [];
const targets = LANGUAGES.filter((language) => language.code !== "en");

for (const language of targets) {
  const localePath = path.join(generatedDir, `${language.code}.json`);
  if (!existsSync(localePath)) {
    failures.push({
      code: language.code,
      error: `generated locale file is missing: ${localePath}`,
    });
    continue;
  }
  try {
    const generated = JSON.parse(readFileSync(localePath, "utf8")) as Record<
      string,
      Tree
    >;
    const diff = diffKeyTrees(english, generated);
    const englishFallbacks = findEnglishFallbackKeys(
      english.mobile,
      generated.mobile,
      TRACKED_MOBILE_FALLBACK_KEYS,
    );
    if (
      diff.missing.length > 0 ||
      diff.extra.length > 0 ||
      diff.typeMismatches.length > 0 ||
      englishFallbacks.length > 0
    ) {
      failures.push({ code: language.code, diff, englishFallbacks });
    }
  } catch (error) {
    failures.push({
      code: language.code,
      error: `could not parse ${localePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

if (failures.length > 0) {
  console.error(
    "Generated locales have structural differences or tracked English fallbacks.",
  );
  for (const failure of failures) {
    console.error(`\n[${failure.code}]`);
    if (failure.error) console.error(`  ERROR: ${failure.error}`);
    for (const key of failure.diff?.missing ?? []) {
      console.error(`  MISSING: ${key}`);
    }
    for (const key of failure.diff?.extra ?? []) {
      console.error(`  EXTRA: ${key}`);
    }
    for (const mismatch of failure.diff?.typeMismatches ?? []) {
      console.error(`  TYPE: ${mismatch}`);
    }
    for (const key of failure.englishFallbacks ?? []) {
      console.error(`  ENGLISH FALLBACK: mobile.${key}`);
    }
    console.error(
      `  Fix: pnpm --filter @workspace/scripts run generate:locales ${failure.code}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Locale key trees match English with no tracked mobile fallbacks across ${targets.length} generated languages.`,
  );
}