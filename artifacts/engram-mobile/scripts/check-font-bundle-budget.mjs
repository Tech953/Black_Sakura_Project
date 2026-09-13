#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirectory = path.join(mobileRoot, "assets", "fonts");
const fontBudgetBytes = 1_350_000;
const requiredFonts = [
  "engram-noto-arabic.woff2",
  "engram-noto-cjk.woff2",
  "engram-noto-cyrillic.woff2",
  "engram-noto-devanagari.woff2",
  "engram-noto-greek.woff2",
  "engram-noto-hebrew.woff2",
  "engram-noto-latin.woff2",
];

const missingFonts = requiredFonts.filter(
  (font) => !statSync(path.join(fontDirectory, font), { throwIfNoEntry: false }),
);
if (missingFonts.length > 0) {
  throw new Error(`Missing bundled Unicode PDF fonts: ${missingFonts.join(", ")}`);
}

const fontFiles = readdirSync(fontDirectory)
  .filter((font) => font.endsWith(".woff2"))
  .map((font) => ({
    name: font,
    bytes: statSync(path.join(fontDirectory, font)).size,
  }));
const totalBytes = fontFiles.reduce((total, font) => total + font.bytes, 0);

if (totalBytes > fontBudgetBytes) {
  throw new Error(
    `Bundled Unicode PDF fonts use ${totalBytes} bytes, over the ${fontBudgetBytes}-byte mobile budget.`,
  );
}

console.log(
  `Bundled Unicode PDF fonts use ${totalBytes} / ${fontBudgetBytes} bytes (${fontFiles.length} WOFF2 assets).`,
);