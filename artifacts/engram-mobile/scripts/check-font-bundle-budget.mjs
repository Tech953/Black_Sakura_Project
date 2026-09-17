#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateWebExportFontUnicodeCoverage,
} from "./check-font-unicode-coverage.mjs";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fontDirectory = path.join(mobileRoot, "assets", "fonts");
const fontBudgetBytes = 1_350_000;

validateWebExportFontUnicodeCoverage();

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