import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.WEB_BROWSER_TEST_PORT ?? 5188);
const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? `http://127.0.0.1:${port}`;
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9229);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
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
const collectOutput = (chunk) => {
  serverOutput += chunk.toString();
  if (serverOutput.length > 12000) serverOutput = serverOutput.slice(-12000);
};
server.stdout.on("data", collectOutput);
server.stderr.on("data", collectOutput);

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
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
  for (const [script, label, portOffset] of [
    ["test:browser:chat", "chat", 0],
    ["test:browser:simulations", "simulations", 1],
    ["test:browser:analytics", "Analytics", 2],
    ["test:browser:download", "download metadata", 3],
  ]) {
    const result = spawn(
      pnpm,
      ["--filter", "@workspace/engram", "run", script],
      {
        env: {
          ...process.env,
          ENGRAM_BROWSER_TEST_URL: appUrl,
          ENGRAM_BROWSER_DEBUG_PORT: String(debugPort + portOffset),
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