#!/usr/bin/env node

/**
 * Pre-device gate for the native media-picker upload smoke test.
 *
 * Linux cannot automate the iOS Files or Android DocumentsUI picker. This
 * gate checks the picker-to-multipart contract and the real API route, then
 * prints the exact physical-device checks needed to prove that native picker
 * URIs, filenames, MIME values, and created assets survive on both platforms.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(mobileRoot, "../..");
const args = new Set(process.argv.slice(2));
const platform =
  process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ?? "both";

if (!["android", "ios", "both"].includes(platform)) {
  console.error("Usage: pnpm run smoke:media -- --platform=android|ios|both");
  process.exit(2);
}

function source(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireSource(root, relativePath, snippets) {
  const contents = source(root, relativePath);
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      throw new Error(`${relativePath} is missing the media picker smoke contract: ${snippet}`);
    }
  }
}

function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  requireSource(mobileRoot, "app/(tabs)/media.tsx", [
    "DocumentPicker.getDocumentAsync",
    'type: ["text/*", "image/*", "audio/*", "video/*", "application/json"]',
    "copyToCacheDirectory: true",
    "normalizeMediaUploadMimeType(picked.name, picked.mimeType)",
    'testID="media-file-picker"',
    'testID="media-selected-mime"',
    'testID="media-upload"',
    'testID={`media-asset-mime-${asset.id}`}',
    'body.append("engramId", String(selectedId))',
    'body.append("file", {',
    "type: file.mimeType",
  ]);
  requireSource(workspaceRoot, "artifacts/api-server/src/routes/media.ts", [
    'const uploadSingle = upload.single("file")',
    "const mimeType = normalizeMediaMimeType(file.mimetype)",
    "const modality = detectModality(mimeType)",
    "contentMatchesMime(file.buffer, mimeType)",
    "filenameMatchesMime(file.originalname, mimeType)",
    "createMediaAsset({",
    "mimeType,",
    "modality,",
    "res.status(201).json(serializeAsset(asset))",
  ]);

  run("pnpm", ["exec", "vitest", "run", "lib/media-upload.test.ts"], mobileRoot);
  run(
    "pnpm",
    ["--filter", "@workspace/api-server", "exec", "vitest", "run", "src/routes/media.test.ts"],
    workspaceRoot,
  );
  console.log(`[media-smoke] picker/upload/API gate passed for ${platform}.`);
} catch (error) {
  console.error(`[media-smoke] pre-device gate failed: ${error.message}`);
  process.exitCode = 1;
}

if (args.has("--print-checklist") || !args.has("--ci")) {
  const deviceLabel = platform === "both" ? "Android and iOS" : platform;
  console.log(`
[media-smoke] Manual physical-device checks (${platform})

Use the same four valid files on every device:
  - notes.txt  -> expected text/plain
  - scene.png  -> expected image/png
  - voice.m4a  -> expected audio/mp4
  - clip.mp4   -> expected video/mp4

1. Build and install the current native app on a physical ${deviceLabel} device.
2. Sign in, open Media, select an engram, and keep the device online. Open the
   native picker from the media upload card (testID media-file-picker).
3. Select each sample one at a time from the platform's real provider:
   Android Files/DocumentsUI and iOS Files/iCloud Drive. Before uploading,
   confirm the selected MIME shown in the app (testID media-selected-mime)
   matches the expected value above. On Android, repeat voice.m4a from a
   provider that reports application/octet-stream; the app must still show
   audio/mp4 by extension.
4. Tap Perceive (testID media-upload). Confirm the request succeeds without
   an error alert and a new asset card appears for the selected filename.
   The card must show the server-returned normalized MIME (testID
   media-asset-mime-<id>) and a Queued or Perceived status. This proves the
   API received the normalized MIME and created the asset, rather than only
   proving that a URI was returned by the picker.
5. Repeat all four uploads on the same device, then repeat all four on the
   other platform when running both. Confirm the filename, MIME, modality icon,
   and byte size remain correct after leaving and reopening the Media screen.
6. Record device model/OS, Files provider, picker-reported MIME when visible,
   normalized MIME, asset ID, and result for all eight platform/sample cases
   in the release QA record. Do not treat a browser upload or simulator-only
   picker as a real-device pass.

Run this command again with --ci for the non-interactive source and test gate
used by release automation.
`);
}