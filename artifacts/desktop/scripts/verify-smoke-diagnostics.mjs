import { existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_VERIFIED_DIAGNOSTIC_BYTES = 256 * 1024;
const PROBE_SECRET = "diagnostic-probe-secret";
const requiredLogNames = [
  "smoke.log",
  "main.log",
  "server.stdout.log",
  "server.stderr.log",
];

function getSecretValues(env) {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        Boolean(value) &&
        /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(
          name,
        ) &&
        value.length >= 4,
    )
    .map(([, value]) => value);
}

export function verifyPackagedSmokeDiagnostics({
  diagnosticsDir,
  resourceListingPath,
  platform,
  cwd = process.cwd(),
  workspace = process.env.GITHUB_WORKSPACE,
  home = os.homedir(),
  tempDir = os.tmpdir(),
  secretValues = getSecretValues(process.env),
  maxBytes = MAX_VERIFIED_DIAGNOSTIC_BYTES,
} = {}) {
  if (!diagnosticsDir || !resourceListingPath || !platform) {
    throw new Error(
      "Usage: node verify-smoke-diagnostics.mjs <probe-dir> <platform> <resource-listing>",
    );
  }

  const files = new Map();
  for (const name of requiredLogNames) {
    const filePath = path.join(diagnosticsDir, name);
    if (!existsSync(filePath)) {
      throw new Error(`Missing required packaged smoke diagnostic: ${name}`);
    }
    const size = statSync(filePath).size;
    if (size > maxBytes) {
      throw new Error(
        `Packaged smoke diagnostic exceeds ${maxBytes} bytes: ${name} (${size})`,
      );
    }
    files.set(name, readFileSync(filePath, "utf8"));
  }

  if (!existsSync(resourceListingPath)) {
    throw new Error("Missing packaged resource-listing.txt");
  }
  const listingSize = statSync(resourceListingPath).size;
  if (listingSize > maxBytes) {
    throw new Error(
      `Packaged smoke diagnostic exceeds ${maxBytes} bytes: resource-listing.txt (${listingSize})`,
    );
  }
  const listing = readFileSync(resourceListingPath, "utf8");
  files.set("resource-listing.txt", listing);

  const smokeLog = files.get("smoke.log");
  if (
    !smokeLog.includes("[smoke] /api/healthz -> 200 OK") ||
    !smokeLog.includes("intentional diagnostics probe: health check failure") ||
    !smokeLog.includes("token=[redacted]") ||
    !smokeLog.includes("<tmp>")
  ) {
    throw new Error(
      "Smoke log is missing the expected failed health-check and redaction evidence",
    );
  }

  const mainLog = files.get("main.log");
  if (!mainLog.includes("desktop main process initialized")) {
    throw new Error("Main-process startup evidence is missing");
  }
  if (
    !mainLog.includes("diagnostics probe marker token=[redacted]") ||
    !mainLog.includes("<tmp>")
  ) {
    throw new Error(
      "Main-process diagnostic is missing credential/path redaction evidence",
    );
  }
  if (
    !files
      .get("server.stdout.log")
      .includes("embedded server stdout capture active")
  ) {
    throw new Error("Embedded server stdout log is missing its capture marker");
  }
  if (
    !files
      .get("server.stderr.log")
      .includes("embedded server stderr capture active")
  ) {
    throw new Error("Embedded server stderr log is missing its capture marker");
  }
  if (!listing.includes(`platform=${platform}`)) {
    throw new Error("Resource listing does not identify the runner platform");
  }
  if (!listing.includes("artifacts/desktop/release/")) {
    throw new Error(
      "Resource listing does not contain a relative release path",
    );
  }

  const machinePaths = [workspace, cwd, home, tempDir].filter(
    (value) => value && value.length >= 4,
  );
  const allText = [...files.values()].join("\n");
  for (const machinePath of machinePaths) {
    if (allText.includes(machinePath)) {
      throw new Error(
        "Packaged smoke diagnostics contain an unredacted machine path",
      );
    }
  }
  for (const secret of secretValues) {
    if (allText.includes(secret)) {
      throw new Error(
        "Packaged smoke diagnostics contain an unredacted credential",
      );
    }
  }
  if (
    /\bBearer\s+(?!\[redacted\])\S+/i.test(allText) ||
    /\b(?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*(?!\[redacted\])[^\s,;]+/i.test(
      allText,
    )
  ) {
    throw new Error(
      "Packaged smoke diagnostics contain a credential-shaped value",
    );
  }
  if (allText.includes(PROBE_SECRET)) {
    throw new Error("Packaged smoke diagnostics contain the probe secret");
  }

  return {
    files: [...files.keys()],
    totalBytes: [...files.values()].reduce(
      (total, value) => total + Buffer.byteLength(value),
      0,
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [diagnosticsDir, platform, resourceListingPath] = process.argv.slice(2);
  const result = verifyPackagedSmokeDiagnostics({
    diagnosticsDir,
    platform,
    resourceListingPath,
  });
  console.log(
    `[smoke] verified ${result.files.length} bounded diagnostic files (${result.totalBytes} bytes)`,
  );
}
