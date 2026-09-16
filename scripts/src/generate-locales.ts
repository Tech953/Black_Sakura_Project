/**
 * Generate translated locale trees for @workspace/i18n.
 *
 * Reads lib/i18n/src/en/<namespace>.json (authoring source of truth), translates
 * each namespace into every non-English supported language with the configured
 * LLM, and writes full trees to lib/i18n/src/generated/<lang>.json.
 *
 * Usage: pnpm --filter @workspace/scripts run generate:locales [langs...]
 *   (no args = all languages; args like "es fr" restrict the run)
 *   --refresh-fallbacks retranslates values that still equal English
 *   --refresh-key=namespace.path limits fallback refresh to one key path
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import { LANGUAGES } from "@workspace/i18n";
import {
  DEFAULT_GENERATED_LOCALE_DIR,
  keysMatch,
  loadEnglish,
  type Tree,
} from "./locale-key-tree.js";

const OUT_DIR = DEFAULT_GENERATED_LOCALE_DIR;

const baseURL = process.env.LLM_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
const apiKey = process.env.LLM_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "local";
const MODEL = process.env.LLM_MODEL ?? "gpt-5.4";
const baseURLConfig =
  process.env.LLM_BASE_URL !== undefined
    ? "LLM_BASE_URL"
    : "AI_INTEGRATIONS_OPENAI_BASE_URL";
const apiKeyConfig =
  process.env.LLM_API_KEY !== undefined
    ? "LLM_API_KEY"
    : process.env.AI_INTEGRATIONS_OPENAI_API_KEY !== undefined
      ? "AI_INTEGRATIONS_OPENAI_API_KEY"
      : null;
if (!baseURL) {
  throw new Error(
    `No locale translation endpoint configured. Set LLM_BASE_URL or AI_INTEGRATIONS_OPENAI_BASE_URL.`,
  );
}
const client = new OpenAI({ baseURL, apiKey });

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

async function preflightProvider(): Promise<void> {
  try {
    await client.models.list();
  } catch (error) {
    const status = providerStatus(error);
    if (status === 401) {
      const credentialMessage = apiKeyConfig
        ? `The configured ${apiKeyConfig} was rejected.`
        : "No API-key variable is configured; set LLM_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY.";
      throw new Error(
        `Locale translation provider authentication failed (HTTP 401). ${credentialMessage} ` +
          `The endpoint is configured through ${baseURLConfig}. No credential values were printed.`,
      );
    }
    throw new Error(
      `Locale translation provider preflight failed${
        status ? ` (HTTP ${status})` : ""
      }. Check ${baseURLConfig}${
        apiKeyConfig
          ? ` and ${apiKeyConfig}`
          : "; set LLM_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY"
      }. No credential values were printed.`,
    );
  }
}

async function translateNamespace(ns: string, tree: Tree, lang: { code: string; englishName: string }): Promise<Tree> {
  if (Object.keys(tree).length === 0) return {};
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await client.chat.completions.create({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a professional software localizer. Translate the JSON values from English to ${lang.englishName} for a sci-fi AI-companion app called ENGRAM (dark terminal aesthetic; concise UI copy; "engram" is a product term — keep it untranslated, as are PYRI, Full Rezz, and Night City character names). Rules:
- Return ONLY a JSON object with the EXACT same keys and nesting; translate values only.
- Preserve all {{placeholders}} exactly.
- Keep translations as concise as the English (UI labels, not prose).
- Translate ordinary UI labels such as "Off", "Short", and "Extended" when the target language has a natural equivalent; do not leave English UI words unchanged unless they are brand or technical terms.
- Keep technical/brand terms (ENGRAM, PYRI, API, URL) unchanged.`,
        },
        { role: "user", content: JSON.stringify(tree, null, 2) },
      ],
    });
    try {
      const parsed = JSON.parse(res.choices[0].message.content ?? "{}") as Tree;
      if (keysMatch(tree, parsed)) return parsed;
      console.warn(`  [${lang.code}/${ns}] key mismatch, attempt ${attempt}`);
    } catch {
      console.warn(`  [${lang.code}/${ns}] bad JSON, attempt ${attempt}`);
    }
  }
  throw new Error(`Failed to translate ${ns} -> ${lang.code} after 3 attempts`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function englishFallbackTree(english: unknown, existing: unknown): unknown {
  if (typeof english === "string") {
    return english === existing ? english : undefined;
  }
  if (!isObject(english) || !isObject(existing)) return undefined;

  const result: Tree = {};
  for (const [key, value] of Object.entries(english)) {
    const child = englishFallbackTree(value, existing[key]);
    if (child !== undefined) result[key] = child;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function mergeTrees(base: unknown, updates: unknown): unknown {
  if (!isObject(base) || !isObject(updates)) return updates;
  const result: Tree = { ...base };
  for (const [key, value] of Object.entries(updates)) {
    result[key] = mergeTrees(result[key], value);
  }
  return result;
}

function fillMissingEnglish(base: unknown, english: unknown): unknown {
  if (!isObject(english)) return base === undefined ? english : base;
  const result: Tree = isObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(english)) {
    result[key] =
      key in result ? fillMissingEnglish(result[key], value) : value;
  }
  return result;
}

function pickTreePaths(tree: unknown, paths: string[]): Tree {
  const result: Tree = {};
  for (const path of paths) {
    const segments = path.split(".").filter(Boolean);
    let source: unknown = tree;
    let target: Tree = result;
    for (const [index, segment] of segments.entries()) {
      if (!isObject(source) || !(segment in source)) break;
      if (index === segments.length - 1) {
        target[segment] = source[segment];
        break;
      }
      if (!isObject(source[segment])) break;
      target[segment] ??= {};
      target = target[segment] as Tree;
      source = source[segment];
    }
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const refreshFallbacks = args.includes("--refresh-fallbacks");
  const fallbackOnError = process.env.LOCALE_FALLBACK_ON_ERROR === "1";
  const refreshKeys = args
    .filter((arg) => arg.startsWith("--refresh-key="))
    .map((arg) => arg.slice("--refresh-key=".length));
  const only = args.filter(
    (arg) => arg !== "--refresh-fallbacks" && !arg.startsWith("--refresh-key="),
  );
  const english = loadEnglish();
  const targets = LANGUAGES.filter((l) => l.code !== "en" && (only.length === 0 || only.includes(l.code)));
  await preflightProvider();
  console.log(`Locale translation provider preflight passed for ${targets.length} locale(s).`);
  for (const lang of targets) {
    const outPath = path.join(OUT_DIR, `${lang.code}.json`);
    const existing: Record<string, Tree> = existsSync(outPath)
      ? JSON.parse(readFileSync(outPath, "utf8"))
      : {};
    const result: Record<string, Tree> = {};
    for (const [ns, tree] of Object.entries(english)) {
      // Reuse an existing namespace translation when its key set still matches.
      if (existing[ns] && keysMatch(tree, existing[ns])) {
        if (refreshFallbacks || refreshKeys.length > 0) {
          const selectedTree =
            refreshKeys.length > 0
              ? pickTreePaths(
                  tree,
                  refreshKeys
                    .filter((key) => key.startsWith(`${ns}.`))
                    .map((key) => key.slice(ns.length + 1)),
                )
              : tree;
          const fallbackTree = englishFallbackTree(
            selectedTree,
            refreshKeys.length > 0
              ? pickTreePaths(
                  existing[ns],
                  refreshKeys
                    .filter((key) => key.startsWith(`${ns}.`))
                    .map((key) => key.slice(ns.length + 1)),
                )
              : existing[ns],
          );
          if (fallbackTree) {
            console.log(`refreshing English fallbacks in ${ns} -> ${lang.code}`);
            const translated = await translateNamespace(ns, fallbackTree as Tree, lang);
            result[ns] = mergeTrees(existing[ns], translated) as Tree;
            continue;
          }
        }
        result[ns] = existing[ns];
        continue;
      }
      console.log(`translating ${ns} -> ${lang.code} (${Object.keys(tree).length} top-level keys)`);
      try {
        result[ns] = await translateNamespace(ns, tree, lang);
      } catch (error) {
        if (!fallbackOnError) throw error;
        console.warn(
          `  [${lang.code}/${ns}] translation unavailable; preserving existing values and adding English fallbacks`,
        );
        result[ns] = fillMissingEnglish(existing[ns], tree) as Tree;
      }
    }
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
    console.log(`wrote ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
