#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateWebExportFontAssets,
} from "./check-web-export-font-assets.mjs";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const REQUIRED_UNICODE_FONT_COVERAGE = [
  {
    family: "Engram Noto Devanagari",
    file: "engram-noto-devanagari.woff2",
    codePoints: [
      { codePoint: 0x0928, name: "DEVANAGARI LETTER NA" },
      { codePoint: 0x094d, name: "DEVANAGARI SIGN VIRAMA" },
      { codePoint: 0x0947, name: "DEVANAGARI VOWEL SIGN E" },
    ],
  },
  {
    family: "Engram Noto Hebrew",
    file: "engram-noto-hebrew.woff2",
    codePoints: [
      { codePoint: 0x05e9, name: "HEBREW LETTER SHIN" },
      { codePoint: 0x05b8, name: "HEBREW POINT QAMATS" },
      { codePoint: 0x05dc, name: "HEBREW LETTER LAMED" },
    ],
  },
  {
    family: "Engram Noto Greek",
    file: "engram-noto-greek.woff2",
    codePoints: [
      { codePoint: 0x0393, name: "GREEK CAPITAL LETTER GAMMA" },
      { codePoint: 0x03ac, name: "GREEK SMALL LETTER ALPHA WITH TONOS" },
      { codePoint: 0x03c9, name: "GREEK SMALL LETTER OMEGA" },
    ],
  },
];

function formatCodePoint(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function parseFontconfigCharset(charset) {
  const ranges = [];
  for (const token of charset.trim().split(/\s+/).filter(Boolean)) {
    const [startToken, endToken = startToken] = token.split("-");
    const start = Number.parseInt(startToken, 16);
    const end = Number.parseInt(endToken, 16);
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start
    ) {
      throw new Error(`Invalid fontconfig charset range "${token}".`);
    }
    ranges.push({ start, end });
  }
  return ranges;
}

function charsetContains(ranges, codePoint) {
  return ranges.some(
    ({ start, end }) => codePoint >= start && codePoint <= end,
  );
}

function queryFontconfigCharset(filePath) {
  const result = spawnSync(
    "fc-query",
    ["--format=%{charset}", filePath],
    { encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `fc-query exited with code ${result.status}: ${(result.stderr ?? "").trim()}`,
    );
  }
  return result.stdout ?? "";
}

export function validateWebExportFontUnicodeCoverage({
  root = mobileRoot,
  queryCharset = queryFontconfigCharset,
} = {}) {
  const assets = new Map(
    validateWebExportFontAssets({ root }).map((asset) => [asset.file, asset]),
  );
  const failures = [];

  for (const requirement of REQUIRED_UNICODE_FONT_COVERAGE) {
    const asset = assets.get(path.join("assets", "fonts", requirement.file));
    const relativeFile = path.join("assets", "fonts", requirement.file);
    const filePath = path.join(root, relativeFile);
    if (!asset || !existsSync(filePath)) {
      failures.push(
        `Missing Unicode PDF font family "${requirement.family}" file "${relativeFile}" while checking script coverage.`,
      );
      continue;
    }

    let ranges;
    try {
      ranges = parseFontconfigCharset(queryCharset(filePath));
    } catch (error) {
      failures.push(
        `Could not inspect Unicode coverage for font family "${requirement.family}" file "${relativeFile}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    for (const { codePoint, name } of requirement.codePoints) {
      if (!charsetContains(ranges, codePoint)) {
        failures.push(
          `Unicode PDF font family "${requirement.family}" file "${relativeFile}" is missing required code point ${formatCodePoint(codePoint)} (${name}).`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return REQUIRED_UNICODE_FONT_COVERAGE.map(({ family, file, codePoints }) => ({
    family,
    file: path.join("assets", "fonts", file),
    codePoints: codePoints.map(({ codePoint }) => formatCodePoint(codePoint)),
  }));
}

function main() {
  const assets = validateWebExportFontUnicodeCoverage();
  console.log(
    `Validated required Unicode coverage for ${assets.length} bundled PDF font families.`,
  );
}

const isMain =
  process.argv[1] &&
  existsSync(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(
      `Font Unicode coverage check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}