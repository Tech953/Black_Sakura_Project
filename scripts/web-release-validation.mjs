import { spawn, spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

function configuredPort(name) {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535; received "${raw}"`);
  }
  return value;
}

async function findFreePort(excluded = new Set()) {
  while (true) {
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const address = probe.address();
        const selected = typeof address === "object" && address ? address.port : null;
        probe.close((error) => (error ? reject(error) : resolve(selected)));
      });
    });
    if (Number.isInteger(port) && !excluded.has(port)) return port;
  }
}

function portOwner(port) {
  const result = spawnSync(
    "lsof",
    ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { encoding: "utf8" },
  );
  const owner =
    result.status === 0
      ? result.stdout.trim().split("\n").slice(0, 3).join(" | ")
      : "";
  return owner || "owner unavailable";
}

async function assertPortAvailable(port, label) {
  try {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => {
        probe.close((error) => (error ? reject(error) : resolve()));
      });
    });
  } catch {
    throw new Error(
      `${label} port ${port} is already in use (${portOwner(port)}). ` +
        `Set a different explicit port or stop the owning process.`,
    );
  }
}

function waitForExit(child) {
  return new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      resolveExit(code ?? (signal ? 1 : 0)),
    );
  });
}

async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    ...options,
    stdio: options.stdio ?? "inherit",
  });
  const exitCode = await waitForExit(child);
  if (exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${exitCode}`,
    );
  }
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(2000),
  ]);
}

function filesContaining(root, text) {
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...filesContaining(path, text));
    } else if (entry.isFile()) {
      try {
        if (readFileSync(path, "utf8").includes(text)) matches.push(path);
      } catch {
        // Ignore non-text assets in the production bundle.
      }
    }
  }
  return matches;
}

function assertProductionBundleHasNoFixtureIdentity(distDir) {
  for (const marker of ["browser-test-user", "browser-test-session"]) {
    const matches = filesContaining(distDir, marker);
    if (matches.length > 0) {
      throw new Error(
        `Production bundle contains browser fixture marker "${marker}": ${matches.join(", ")}`,
      );
    }
  }
}

const configuredWebPort = configuredPort("WEB_BROWSER_TEST_PORT");
const configuredDebugPort = configuredPort("ENGRAM_BROWSER_DEBUG_PORT");
const port = configuredWebPort ?? (await findFreePort());
const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? `http://127.0.0.1:${port}`;
const scripts = [
  ["test:browser:chat", "chat"],
  ["test:browser:group-chat", "Commons transcript and group chat"],
  ["test:browser:simulations", "simulations"],
  ["test:browser:analytics", "Analytics"],
  ["test:browser:download", "download metadata"],
  ["test:browser:settings", "Settings local server"],
];
const debugPorts = [];
if (configuredDebugPort !== null) {
  for (let offset = 0; offset < scripts.length; offset += 1) {
    const candidate = configuredDebugPort + offset;
    if (candidate > 65535) {
      throw new Error(
        `ENGRAM_BROWSER_DEBUG_PORT plus browser-check offsets must stay within 65535; received ${candidate}`,
      );
    }
    debugPorts.push(candidate);
  }
} else {
  const excluded = new Set([port]);
  for (let index = 0; index < scripts.length; index += 1) {
    const selected = await findFreePort(excluded);
    excluded.add(selected);
    debugPorts.push(selected);
  }
}
if (configuredWebPort !== null) await assertPortAvailable(port, "Web fixture");
if (configuredDebugPort !== null) {
  for (const [index, debugPort] of debugPorts.entries()) {
    await assertPortAvailable(debugPort, `Browser check ${scripts[index][1]}`);
  }
}
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
console.log(
  `Web browser validation ports: app=${appUrl}, cdp=${debugPorts.join(",")}`,
);
const server = spawn(
  pnpm,
  ["--filter", "@workspace/engram", "run", "dev"],
  {
    env: {
      ...process.env,
      PORT: String(port),
      VITE_BROWSER_TEST: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let serverOutput = "";
let serverFailure = null;
server.once("error", (error) => {
  serverFailure = error;
});
server.once("exit", (code, signal) => {
  if (!serverFailure) {
    serverFailure = new Error(
      `process exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`,
    );
  }
});
const collectOutput = (chunk) => {
  serverOutput += chunk.toString();
  if (serverOutput.length > 12000) serverOutput = serverOutput.slice(-12000);
};
server.stdout.on("data", collectOutput);
server.stderr.on("data", collectOutput);
let productionServer = null;

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (serverFailure) {
      throw new Error(
        `Web fixture server could not start on ${appUrl}: ${serverFailure.message}`,
      );
    }
    try {
      const response = await fetch(`${appUrl}/`);
      if (response.ok) return;
    } catch {
      // The Vite process may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Web fixture server did not start on ${appUrl}.\n${serverOutput}`);
}

async function runProductionPreview() {
  const excluded = new Set([port, ...debugPorts]);
  const previewPort = await findFreePort(excluded);
  excluded.add(previewPort);
  const previewDebugPort = await findFreePort(excluded);
  const previewUrl = `http://127.0.0.1:${previewPort}`;
  const distDir = resolve("artifacts/engram/dist/public");

  console.log(`Production web preview: app=${previewUrl}, cdp=${previewDebugPort}`);
  await runCommand(
    pnpm,
    ["--filter", "@workspace/engram", "run", "build"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(previewPort),
        VITE_BROWSER_TEST: "false",
      },
    },
  );
  assertProductionBundleHasNoFixtureIdentity(distDir);
  await runCommand(
    pnpm,
    ["--filter", "@workspace/api-server", "run", "build"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
      },
    },
  );

  let previewOutput = "";
  let previewFailure = null;
  productionServer = spawn(
    pnpm,
    ["--filter", "@workspace/api-server", "run", "start"],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(previewPort),
        WEB_DIST: distDir,
        ENGRAM_BROWSER_FIXTURE_MODE: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  productionServer.once("error", (error) => {
    previewFailure = error;
  });
  productionServer.once("exit", (code, signal) => {
    if (!previewFailure) {
      previewFailure = new Error(
        `process exited with ${signal ? `signal ${signal}` : `code ${code ?? "unknown"}`}`,
      );
    }
  });
  const collectPreviewOutput = (chunk) => {
    previewOutput += chunk.toString();
    if (previewOutput.length > 12000) previewOutput = previewOutput.slice(-12000);
  };
  productionServer.stdout.on("data", collectPreviewOutput);
  productionServer.stderr.on("data", collectPreviewOutput);

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (previewFailure) {
      throw new Error(
        `Production web preview could not start on ${previewUrl}: ${previewFailure.message}\n${previewOutput}`,
      );
    }
    try {
      const response = await fetch(`${previewUrl}/api/healthz`);
      if (response.ok) {
        break;
      }
    } catch {
      // The API server may still be starting.
    }
    await delay(250);
  }
  if (Date.now() >= deadline) {
    throw new Error(
      `Production web preview did not start on ${previewUrl}.\n${previewOutput}`,
    );
  }

  const browserCheck = spawn(
    pnpm,
    ["--filter", "@workspace/engram", "run", "test:browser:chat:real-clerk"],
    {
      env: {
        ...process.env,
        ENGRAM_BROWSER_REAL_CLERK: "true",
        ENGRAM_BROWSER_TEST_URL: previewUrl,
        ENGRAM_BROWSER_DEBUG_PORT: String(previewDebugPort),
      },
      stdio: "inherit",
    },
  );
  const exitCode = await waitForExit(browserCheck);
  if (exitCode !== 0) {
    throw new Error(
      `Production web preview archive/export check failed with exit code ${exitCode}`,
    );
  }
}

try {
  await waitForServer();
  for (const [index, [script, label]] of scripts.entries()) {
    const result = spawn(
      pnpm,
      ["--filter", "@workspace/engram", "run", script],
      {
        env: {
          ...process.env,
          ENGRAM_BROWSER_TEST_URL: appUrl,
          ENGRAM_BROWSER_DEBUG_PORT: String(debugPorts[index]),
        },
        stdio: "inherit",
      },
    );
    const exitCode = await new Promise((resolve) => {
      result.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
    if (exitCode !== 0) {
      throw new Error(`Web ${label} browser check failed with exit code ${exitCode}`);
    }
  }
  await stopProcess(server);
  await runProductionPreview();
} finally {
  await stopProcess(server);
  await stopProcess(productionServer);
}
