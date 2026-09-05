/**
 * Generate translated locale trees for @workspace/i18n.
 *
 * Reads lib/i18n/src/en/<namespace>.json (authoring source of truth), translates
 * each namespace into every non-English supported language with the configured
 * LLM, and writes full trees to lib/i18n/src/generated/<lang>.json.
 *
 * Usage: pnpm --filter @workspace/scripts run generate:locales [langs...]
 *   (no args = all languages; args like "es fr" restrict the run)
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
if (!baseURL) throw new Error("No LLM endpoint configured");
const client = new OpenAI({ baseURL, apiKey });

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

async function main() {
  const only = process.argv.slice(2);
  const english = loadEnglish();
  const targets = LANGUAGES.filter((l) => l.code !== "en" && (only.length === 0 || only.includes(l.code)));
  for (const lang of targets) {
    const outPath = path.join(OUT_DIR, `${lang.code}.json`);
    const existing: Record<string, Tree> = existsSync(outPath)
      ? JSON.parse(readFileSync(outPath, "utf8"))
      : {};
    const result: Record<string, Tree> = {};
    for (const [ns, tree] of Object.entries(english)) {
      // Reuse an existing namespace translation when its key set still matches.
      if (existing[ns] && keysMatch(tree, existing[ns])) {
        result[ns] = existing[ns];
        continue;
      }
      console.log(`translating ${ns} -> ${lang.code} (${Object.keys(tree).length} top-level keys)`);
      result[ns] = await translateNamespace(ns, tree, lang);
    }
    writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
    console.log(`wrote ${outPath}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
