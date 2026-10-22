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
    "setFile({",
    "uri: picked.uri",
    "name: picked.name",
    "normalizeMediaUploadMimeType(picked.name, picked.mimeType)",
    'testID="media-file-picker"',
    'testID="media-selected-filename"',
    'testID="media-selected-mime"',
    'testID="media-upload"',
    'testID={`media-asset-mime-${asset.id}`}',
    'body.append("engramId", String(selectedId))',
    'body.append("file", {',
    "type: normalizeMediaUploadMimeType(",
    "request.upload.onprogress",
    "activeUploadRef.current?.abort()",
    'testID="media-upload-cancel"',
    'testID="media-upload-progress"',
    'testID="media-upload-progressbar"',
  ]);
  requireSource(workspaceRoot, "artifacts/api-server/src/routes/media.ts", [
    'const uploadSingle = upload.single("file")',
    "if (req.aborted || res.destroyed) return;",
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
2. Sign in, open Media, select an engram, and keep the device online. Make the
   four sample files available in the platform's real provider:
   Android Files/DocumentsUI and iOS Files/iCloud Drive.
3. For each sample, open the native picker (testID media-file-picker). While
   the picker is still open, background ENGRAM with Home or the app switcher
   for at least 60 seconds; do not force-quit the app. Return to the picker
   through the app switcher/provider and select the sample. If the picker or
   app has disappeared, record that case rather than restarting and treating
   it as a pass.
4. After returning to ENGRAM, confirm the selected filename
   (testID media-selected-filename) and normalized MIME (testID
   media-selected-mime) are still correct before uploading. On Android, repeat
   voice.m4a from a provider that reports application/octet-stream; the app
   must still show audio/mp4 by extension.
5. Tap Perceive (testID media-upload). Confirm the request succeeds without
   an error alert and a new asset card appears for the selected filename. The
   card must show the server-returned normalized MIME (testID
   media-asset-mime-<id>) and a Queued or Perceived status. This proves the API
   received the selected URI and normalized MIME and created the asset.
6. Repeat the background-and-return sequence for all four samples on each
   physical platform being tested. Confirm the filename, MIME, modality icon,
   and byte size remain correct after leaving and reopening the Media screen.
7. Record device model/OS, Files provider, background duration, picker-reported
   MIME when visible, normalized MIME, asset ID, and result for each
   platform/sample case in the release QA record. A cold relaunch that loses
   the selection or a failed upload is a failure. Do not treat browser uploads
   or simulator-only pickers as a real-device pass.
8. Also upload a valid 15–24 MB media file when it fits below the configured
   API limit. Confirm the progress label and bar advance while bytes are
   sending, reach 100% when transfer completes, then disappear after the asset
   is accepted. On failure, confirm the progress indicator clears and the
   selected file remains ready for another attempt.
9. Start another large upload and cancel it before transfer completes
   (testID media-upload-cancel). Confirm no error alert appears, the selected
   file remains in the picker row, and no new asset card is created.

Run this command again with --ci for the non-interactive source and test gate
used by release automation.
`);
}