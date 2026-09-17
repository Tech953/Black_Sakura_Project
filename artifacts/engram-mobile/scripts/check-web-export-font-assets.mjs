#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const WEB_EXPORT_FONT_ASSETS = [
  {
    family: "Engram Noto Arabic",
    file: "engram-noto-arabic.woff2",
    importName: "notoSansArabic",
  },
  {
    family: "Engram Noto CJK",
    file: "engram-noto-cjk.woff2",
    importName: "notoSansCjk",
  },
  {
    family: "Engram Noto Cyrillic",
    file: "engram-noto-cyrillic.woff2",
    importName: "notoSansCyrillic",
  },
  {
    family: "Engram Noto Devanagari",
    file: "engram-noto-devanagari.woff2",
    importName: "notoSansDevanagari",
  },
  {
    family: "Engram Noto Greek",
    file: "engram-noto-greek.woff2",
    importName: "notoSansGreek",
  },
  {
    family: "Engram Noto Hebrew",
    file: "engram-noto-hebrew.woff2",
    importName: "notoSansHebrew",
  },
  {
    family: "Engram Noto Latin",
    file: "engram-noto-latin.woff2",
    importName: "notoSansLatin",
  },
];

export function validateWebExportFontAssets({
  root = mobileRoot,
  source = readFileSync(path.join(root, "lib", "web-chat-export.ts"), "utf8"),
} = {}) {
  const fontDirectory = path.join(root, "assets", "fonts");
  const stackMarker = "BROWSER_UNICODE_FONT_STACK";
  const fontStack =
    source.indexOf(stackMarker) >= 0
      ? source.slice(source.indexOf(stackMarker))
      : "";
  const failures = [];
  const assets = [];

  for (const asset of WEB_EXPORT_FONT_ASSETS) {
    const filePath = path.join(fontDirectory, asset.file);
    const relativeFile = path.join("assets", "fonts", asset.file);
    const fileInfo = existsSync(filePath) ? statSync(filePath) : null;

    if (!fileInfo?.isFile()) {
      failures.push(
        `Missing Unicode PDF font family "${asset.family}" file "${relativeFile}".`,
      );
    } else if (fileInfo.size === 0) {
      failures.push(
        `Unicode PDF font family "${asset.family}" file "${relativeFile}" is empty.`,
      );
    }

    const importLine = `import ${asset.importName} from "../assets/fonts/${asset.file}";`;
    if (!source.includes(importLine)) {
      failures.push(
        `Unicode PDF font family "${asset.family}" file "${relativeFile}" is not imported by lib/web-chat-export.ts.`,
      );
    }
    if (
      !source.includes(`"${asset.family}":`) ||
      !source.includes(`uri: ${asset.importName}`)
    ) {
      failures.push(
        `Unicode PDF font family "${asset.family}" file "${relativeFile}" is not registered in the browser font map.`,
      );
    }
    if (!fontStack.includes(`"${asset.family}"`)) {
      failures.push(
        `Unicode PDF font family "${asset.family}" file "${relativeFile}" is missing from the browser font stack.`,
      );
    }

    assets.push({
      family: asset.family,
      file: relativeFile,
      bytes: fileInfo?.size ?? 0,
    });
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
  return assets;
}

function main() {
  const assets = validateWebExportFontAssets();
  console.log(
    `Validated ${assets.length} bundled Unicode PDF font assets are present and wired into lib/web-chat-export.ts.`,
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
      `Web export font asset check failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}