import esbuild from "esbuild";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outdir = path.join(here, "dist");
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: {
    main: path.join(here, "src", "main.ts"),
    preload: path.join(here, "src", "preload.ts"),
  },
  outdir,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  sourcemap: false,
  logLevel: "info",
});

const i18nRoot = path.join(here, "..", "..", "lib", "i18n", "src");
const localeFiles = [
  ["en", path.join(i18nRoot, "en", "settings.json")],
  ...readdirSync(path.join(i18nRoot, "generated"))
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => [
      path.basename(file, ".json"),
      path.join(i18nRoot, "generated", file),
    ]),
];
const settingsLocales = Object.fromEntries(
  localeFiles.map(([language, file]) => {
    const locale = JSON.parse(readFileSync(file, "utf8"));
    const settings = language === "en" ? locale : locale.settings;
    if (!settings?.update || !settings?.localModelFailure) {
      throw new Error(`Missing desktop Settings translations for locale ${language}.`);
    }
    return [
      language,
      {
        update: settings.update,
        localModelFailure: settings.localModelFailure,
      },
    ];
  }),
);
const sourceSettingsHtml = readFileSync(
  path.join(here, "src", "settings.html"),
  "utf8",
);
const localeDataStart =
  '<script id="settings-i18n-data" type="application/json">';
const localeDataEnd = "</script>";
const start = sourceSettingsHtml.indexOf(localeDataStart);
const dataStart = start + localeDataStart.length;
const end = sourceSettingsHtml.indexOf(localeDataEnd, dataStart);
if (start < 0 || end < 0) {
  throw new Error("settings.html is missing its locale data script.");
}
const generatedSettingsHtml =
  sourceSettingsHtml.slice(0, dataStart) +
  JSON.stringify(settingsLocales).replaceAll("<", "\\u003c") +
  sourceSettingsHtml.slice(end);
writeFileSync(path.join(outdir, "settings.html"), generatedSettingsHtml);

console.log("[desktop] main + preload + settings.html built ->", outdir);
