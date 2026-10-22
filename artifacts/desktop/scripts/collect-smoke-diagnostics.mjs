import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_RESOURCE_LISTING_BYTES = 256 * 1024;
const MAX_RESOURCE_FILES = 5000;
const MAX_RESOURCE_DEPTH = 4;
const supportedPlatforms = new Set(["linux", "mac", "win"]);

function displayPath(value, cwd) {
  const relative = path.relative(cwd, value);
  if (
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    return "[outside-workspace]";
  }
  return relative.split(path.sep).join("/");
}

function sanitizeListing(value, cwd) {
  let safe = value;
  const replacements = [
    [process.env.GITHUB_WORKSPACE, "<workspace>"],
    [cwd, "<workspace>"],
    [os.tmpdir(), "<tmp>"],
    [os.homedir(), "<home>"],
  ].filter(([source]) => source);
  for (const [source, replacement] of replacements) {
    safe = safe.split(source).join(replacement);
  }
  const secrets = Object.entries(process.env)
    .filter(
      ([name, secret]) =>
        Boolean(secret) &&
        /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(
          name,
        ) &&
        secret.length >= 4,
    )
    .map(([, secret]) => secret);
  for (const secret of secrets) safe = safe.split(secret).join("[redacted]");
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[redacted]",
    );
}

function boundListing(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  const marker = Buffer.from(
    "[resource listing truncated; showing the most recent entries]\n",
    "utf8",
  );
  const tailBytes = Math.max(0, maxBytes - marker.length);
  return Buffer.concat([marker, bytes.subarray(-tailBytes)])
    .subarray(-maxBytes)
    .toString("utf8");
}

export function collectPackagedResourceListing({
  platform,
  releaseDir,
  outputFile,
  cwd = process.cwd(),
  maxBytes = MAX_RESOURCE_LISTING_BYTES,
} = {}) {
  if (!supportedPlatforms.has(platform)) {
    throw new Error(`Unsupported smoke diagnostics platform: ${platform}`);
  }
  if (!releaseDir || !outputFile) {
    throw new Error(
      "Usage: node collect-smoke-diagnostics.mjs <linux|mac|win> <release-dir> <output-file>",
    );
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Resource listing byte limit must be a positive integer");
  }

  const roots = [];
  if (platform === "mac") {
    if (existsSync(releaseDir)) {
      try {
        for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith("mac")) {
            roots.push(
              path.join(
                releaseDir,
                entry.name,
                "ENGRAM.app",
                "Contents",
                "Resources",
              ),
            );
          }
        }
      } catch {
        // A partially written release directory should not block diagnostics.
      }
    }
  } else {
    roots.push(
      path.join(
        releaseDir,
        platform === "win" ? "win-unpacked" : "linux-unpacked",
        "resources",
      ),
    );
  }

  const lines = [`platform=${platform}`];
  let found = false;
  let fileCount = 0;
  let entriesTruncated = false;
  function walk(current, depth) {
    if (depth > MAX_RESOURCE_DEPTH) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (fileCount >= MAX_RESOURCE_FILES) {
        entriesTruncated = true;
        return;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        found = true;
        fileCount += 1;
        const relative = displayPath(full, cwd).replace(/[\r\n\t]/g, " ");
        lines.push(`${relative}\t${lstatSync(full).size} bytes`);
      }
    }
  }

  for (const root of roots) {
    if (!existsSync(root)) continue;
    try {
      if (!statSync(root).isDirectory()) continue;
      lines.push(`[resource-root] ${displayPath(root, cwd)}`);
      walk(root, 0);
    } catch (error) {
      lines.push(
        `[resource-root] listing failed (${String(error?.code ?? "unknown")})`,
      );
    }
  }
  if (!found)
    lines.push("[resource-root] no packaged resources directory found");
  if (entriesTruncated) {
    lines.push("[resource listing truncated: file-count limit reached]");
  }

  const listing = boundListing(
    sanitizeListing(`${lines.sort().join("\n")}\n`, cwd),
    maxBytes,
  );
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, listing, { mode: 0o600 });
  return { outputFile, byteLength: Buffer.byteLength(listing), fileCount };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [platform, releaseDir, outputFile] = process.argv.slice(2);
  const result = collectPackagedResourceListing({
    platform,
    releaseDir,
    outputFile,
  });
  console.log(
    `[smoke] wrote ${result.fileCount} resource entries (${result.byteLength} bytes)`,
  );
}
