#!/usr/bin/env node

/**
 * Pre-device gate for the custom-persona reconnect smoke test.
 *
 * Linux cannot validate native network toggles or a physical phone's
 * background/reconnect behavior. This gate runs the mobile SQLite/retry
 * contract and the API prompt-use contract, then prints the physical-device
 * checks required for release QA.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(mobileRoot, "../..");
const args = new Set(process.argv.slice(2));
const platform =
  process.argv.find((arg) => arg.startsWith("--platform="))?.split("=")[1] ??
  "both";

if (!["android", "ios", "both"].includes(platform)) {
  console.error(
    "Usage: pnpm run smoke:custom-persona -- --platform=android|ios|both",
  );
  process.exit(2);
}

function source(root, relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function requireSource(root, relativePath, snippets) {
  const contents = source(root, relativePath);
  for (const snippet of snippets) {
    if (!contents.includes(snippet)) {
      throw new Error(
        `${relativePath} is missing the custom-persona reconnect contract: ${snippet}`,
      );
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
  requireSource(mobileRoot, "lib/offline/account-isolation.test.ts", [
    "customEngram",
    "network lost during persona upload",
    "getConversation",
    "Bearer clerk-token-reconnect-account",
  ]);
  requireSource(
    workspaceRoot,
    "artifacts/api-server/src/routes/api-routes.test.ts",
    [
      "uses a restored custom persona for the first post-reconnect reply",
      "Post-reconnect reply",
      "customEngram",
    ],
  );

  run(
    "pnpm",
    ["exec", "vitest", "run", "lib/offline/account-isolation.test.ts"],
    mobileRoot,
  );
  run(
    "pnpm",
    [
      "--filter",
      "@workspace/api-server",
      "exec",
      "vitest",
      "run",
      "src/routes/api-routes.test.ts",
      "-t",
      "uses a restored custom persona",
    ],
    workspaceRoot,
  );
  console.log(
    `[custom-persona-smoke] automated reconnect gate passed for ${platform}.`,
  );
} catch (error) {
  console.error(
    `[custom-persona-smoke] pre-device gate failed: ${error.message}`,
  );
  process.exitCode = 1;
}

if (args.has("--print-checklist") || !args.has("--ci")) {
  const deviceLabel = platform === "both" ? "Android and iOS" : platform;
  console.log(`
[custom-persona-smoke] Manual physical-device checks (${platform})

1. Build and install the current native app on a physical ${deviceLabel} device.
2. Sign in, create a conversation in custom mode, and set both a persona name
   and a custom engram context. Send one message while online, then disable the
   network before creating the next local turn.
3. Confirm the offline conversation history still shows the same persona name
   and custom context. Restore network access and authentication, then wait for
   offline synchronization to finish.
4. Send the first post-reconnect message. Confirm the reply follows the custom
   context and the conversation still has the same persona label.
5. Repeat with network loss during synchronization. Confirm retry succeeds,
   the conversation appears exactly once, and neither the persona name nor the
   custom context is duplicated or lost.
6. Record device model/OS, network transition timing, conversation ID/title,
   retry result, and the first post-reconnect reply in the release QA record.

Run this command again with --ci for the automated gate used by release
automation.
`);
}
