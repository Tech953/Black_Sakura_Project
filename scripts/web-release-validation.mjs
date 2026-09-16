import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
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

const configuredWebPort = configuredPort("WEB_BROWSER_TEST_PORT");
const configuredDebugPort = configuredPort("ENGRAM_BROWSER_DEBUG_PORT");
const port = configuredWebPort ?? (await findFreePort());
const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? `http://127.0.0.1:${port}`;
const scripts = [
  ["test:browser:chat", "chat"],
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
} finally {
  if (!server.killed) server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(2000),
  ]);
}