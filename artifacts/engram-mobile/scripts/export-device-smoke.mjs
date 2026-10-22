#!/usr/bin/env node

/**
 * Pre-device gate for the native chat export smoke test.
 *
 * The Linux workspace cannot automate Android/iOS share sheets or Files
 * providers. It validates the native export contract and deterministic file
 * checks, then prints the exact physical-device checks required for release.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const platform =
  process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ??
  "both";

if (!["android", "ios", "both"].includes(platform)) {
  console.error("Usage: pnpm run smoke:exports -- --platform=android|ios|both");
  process.exit(2);
}

function source(relativePath) {
  return readFileSync(path.join(mobileRoot, relativePath), "utf8");
}

function requireSource(relativePath, snippets) {
  const contents = source(relativePath);
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      throw new Error(
        `${relativePath} is missing the native export smoke contract: ${snippet}`,
      );
    }
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: mobileRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  requireSource("app/(tabs)/chat.tsx", [
    "exportNativeChatConversation",
    "FileSystem.getInfoAsync",
    "FileSystem.EncodingType.Base64",
  ]);
  requireSource("lib/native-chat-export.ts", [
    "assertUsableFile",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "format === \"pdf\"",
    "format === \"docx\"",
    "shareAsync",
  ]);
  run("pnpm", ["exec", "vitest", "run", "lib/native-chat-export.test.ts"]);
  console.log(`[export-smoke] native export gate passed for ${platform}.`);
} catch (error) {
  console.error(`[export-smoke] pre-device gate failed: ${error.message}`);
  process.exitCode = 1;
}

if (args.has("--print-checklist") || !args.has("--ci")) {
  console.log(`
[export-smoke] Manual physical-device checks (${platform})

1. Build and install the current native app on a physical ${
    platform === "both" ? "Android and iOS" : platform
  } device.
2. Open a restored conversation containing both a user message and an engram
   response. Open Export conversation and run Markdown, Plain text, PDF, and
   Word document one at a time.
3. For every format, confirm the share sheet opens only after a non-empty file
   is created. Save the shared file to the platform Files provider when
   possible, then confirm the expected extension:
   .md, .txt, .pdf, and .docx.
4. Confirm the PDF opens as a readable PDF and the DOCX opens as a readable
   Word document. Confirm both contain the restored conversation messages.
5. Confirm the share target receives the generated file URI, not the
   conversation text fallback. On Android, inspect the saved file in Files;
   on iOS, inspect it in Files or a document provider.
6. Repeat after restoring an archived conversation. Record device OS/version,
   share target, file sizes, and the result for each format in the release QA
   record.

Run this command again with --ci for the non-interactive source and test gate
used by release automation.
`);
}