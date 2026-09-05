#!/usr/bin/env node

/**
 * Pre-device gate for the mobile custom-GGUF smoke test.
 *
 * This intentionally does not pretend to automate Android/iOS Files-provider
 * UI from the Linux workspace. It validates the checked-in native import
 * contract and runs the deterministic model tests, then prints the exact
 * manual steps required on a physical device.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const platform = process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ?? "both";

if (!["android", "ios", "both"].includes(platform)) {
  console.error("Usage: pnpm run smoke:gguf -- --platform=android|ios|both");
  process.exit(2);
}

function source(relativePath) {
  return readFileSync(path.join(mobileRoot, relativePath), "utf8");
}

function requireSource(relativePath, snippets) {
  const contents = source(relativePath);
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      throw new Error(`${relativePath} is missing the GGUF smoke contract: ${snippet}`);
    }
  }
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: mobileRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

try {
  requireSource("app/server-settings.tsx", [
    "DocumentPicker.getDocumentAsync",
    'testID="active-gguf-model"',
    'testID="gguf-import-progress"',
    "onToggleOffline",
  ]);
  requireSource("lib/offline/model.ts", [
    "CUSTOM_MODEL_PATH",
    "FileSystem.copyAsync",
    "readGgufVersion",
    "getFreeDiskStorageAsync",
    "CUSTOM_METADATA_KEY",
  ]);
  requireSource("lib/offline/llm.ts", ["getActiveModelPath", "validateActiveModel"]);
  const modelSource = source("lib/offline/model.ts");
  if (/\b(fetch|XMLHttpRequest|upload|FormData)\b/.test(modelSource)) {
    throw new Error("The model manager must not upload selected GGUF bytes.");
  }
  console.log(`[gguf-smoke] source/privacy contract passed for ${platform}.`);
  run("pnpm", ["exec", "vitest", "run", "lib/offline/model.test.ts"]);
} catch (error) {
  console.error(`[gguf-smoke] pre-device gate failed: ${error.message}`);
  process.exitCode = 1;
}

if (args.has("--print-checklist") || !args.has("--ci")) {
  console.log(`
[gguf-smoke] Manual physical-device checks (${platform})

1. Build/install the current native app on a physical ${platform === "both" ? "Android and iOS" : platform} device.
2. Open Settings > On-device offline mode while online. Tap Import GGUF and choose a
   valid .gguf from the platform's Files provider (Android Files/DocumentsUI or
   iOS Files/iCloud Drive). Confirm the source filename appears as the active model.
3. Repeat with a non-.gguf file. Confirm an error is shown and the previous active
   model remains selected.
4. With a bundled or previously imported model active, import a structurally valid
   but non-loadable GGUF fixture (GGUF magic/version header with no usable tensors).
   Confirm activation fails and the previous model is restored.
5. Confirm the progress indicator stays between 0% and 100%, then turn on offline
   mode, enable airplane mode, and complete a chat. This proves activation does not
   depend on the provider URI or network after copying.
6. Confirm the selected model remains available after force-closing/reopening the
   app, and that removing it falls back to the bundled model when one is present.
7. Privacy check: while importing and while chatting offline, inspect traffic with
   the device network disabled or a proxy capture. No request may contain model
   bytes or the provider URI. The only persisted model path must be app-private.
8. Storage check: repeat on a device with less than 1.1x the model size free.
   Import must fail before replacing the active model.

Record device OS/version, Files provider, model filename/hash, and each result in
the release QA record. Run this command again with --ci for the non-interactive
source/privacy/test gate used by release automation.
`);
}