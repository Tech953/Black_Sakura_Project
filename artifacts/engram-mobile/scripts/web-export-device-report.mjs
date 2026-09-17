#!/usr/bin/env node

/**
 * Validate files collected from the physical web-export regression.
 *
 * The browser's download response MIME is reported separately from the
 * filesystem MIME because some file providers (notably iOS Files) do not
 * preserve the original Content-Type metadata for text files.
 */

import { readFile, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const formats = [
  {
    format: "md",
    mimeType: "text/markdown",
    acceptedDetectedMimeTypes: ["text/markdown", "text/plain"],
  },
  {
    format: "txt",
    mimeType: "text/plain",
    acceptedDetectedMimeTypes: ["text/plain"],
  },
  {
    format: "pdf",
    mimeType: "application/pdf",
    acceptedDetectedMimeTypes: ["application/pdf"],
    signature: [37, 80, 68, 70],
  },
  {
    format: "docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    acceptedDetectedMimeTypes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/zip",
    ],
    signature: [80, 75, 3, 4],
  },
];

function option(name) {
  const value = process.argv.find((argument) => argument.startsWith(`${name}=`));
  return value?.slice(name.length + 1);
}

function usage() {
  return [
    "Usage:",
    "  node scripts/web-export-device-report.mjs",
    "    --platform=ios|android",
    "    --browser=safari|firefox",
    "    --dir=/path/to/transferred/files",
    "    [--prefix=Hydrated-history]",
  ].join("\n");
}

function fail(message) {
  throw new Error(`${message}\n\n${usage()}`);
}

function normalizeMimeType(value) {
  return value.trim().split(";")[0].toLowerCase();
}

function detectMimeType(filePath) {
  const result = spawnSync("file", ["--brief", "--mime-type", filePath], {
    encoding: "utf8",
  });
  if (result.error) {
    throw new Error(`Could not run file to inspect ${filePath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Could not detect the MIME type for ${filePath}: ${result.stderr.trim()}`,
    );
  }
  return normalizeMimeType(result.stdout);
}

async function validateFormat(directory, prefix, definition) {
  const filename = `${prefix}.${definition.format}`;
  const filePath = path.join(directory, filename);
  const fileInfo = await stat(filePath).catch(() => null);
  if (!fileInfo?.isFile()) {
    throw new Error(`Missing downloaded ${definition.format} file: ${filePath}`);
  }
  if (fileInfo.size <= 0) {
    throw new Error(`Downloaded ${filename} is empty`);
  }

  const bytes = await readFile(filePath);
  if (
    definition.signature &&
    definition.signature.some((byte, index) => bytes[index] !== byte)
  ) {
    throw new Error(
      `Downloaded ${filename} has an invalid signature: ${JSON.stringify(
        Array.from(bytes.subarray(0, 4)),
      )}`,
    );
  }

  const detectedMimeType = detectMimeType(filePath);
  if (!definition.acceptedDetectedMimeTypes.includes(detectedMimeType)) {
    throw new Error(
      `Downloaded ${filename} has unexpected detected MIME ${detectedMimeType}; ` +
        `expected one of ${definition.acceptedDetectedMimeTypes.join(", ")}`,
    );
  }

  return {
    format: definition.format,
    filename,
    declaredMimeType: definition.mimeType,
    detectedMimeType,
    size: fileInfo.size,
    signature: definition.signature
      ? Array.from(bytes.subarray(0, definition.signature.length))
      : Array.from(bytes.subarray(0, Math.min(bytes.length, 4))),
  };
}

async function main() {
  const platform = option("--platform");
  const browser = option("--browser");
  const directory = option("--dir");
  const prefix = option("--prefix") ?? "Hydrated-history";

  if (
    !(
      (platform === "ios" && browser === "safari") ||
      (platform === "android" && browser === "firefox")
    )
  ) {
    fail("Use the physical browser pair --platform=ios --browser=safari or --platform=android --browser=firefox.");
  }
  if (!directory) fail("Missing --dir for the transferred downloaded files.");
  if (path.basename(prefix) !== prefix || prefix.length === 0) {
    fail("--prefix must be a non-empty filename stem without path separators.");
  }

  const resolvedDirectory = path.resolve(directory);
  const results = [];
  for (const definition of formats) {
    results.push(await validateFormat(resolvedDirectory, prefix, definition));
  }

  console.log(
    JSON.stringify(
      {
        physicalWebExportCoverage: [
          {
            platform,
            browser,
            status: "passed",
            directory: path.basename(resolvedDirectory),
            formats: results,
          },
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    `Physical web export report failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});