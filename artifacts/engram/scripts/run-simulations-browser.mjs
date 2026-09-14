import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = Number(process.env.WEB_BROWSER_TEST_PORT ?? 5188);
const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? `http://127.0.0.1:${port}`;
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9230);
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const ownsServer = !process.env.ENGRAM_BROWSER_TEST_URL;

let server;
let serverOutput = "";

if (ownsServer) {
  server = spawn(pnpm, ["run", "dev"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      PORT: String(port),
      VITE_BROWSER_TEST: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collectOutput = (chunk) => {
    serverOutput += chunk.toString();
    if (serverOutput.length > 12000) serverOutput = serverOutput.slice(-12000);
  };
  server.stdout.on("data", collectOutput);
  server.stderr.on("data", collectOutput);
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${appUrl}/`);
      if (response.ok) return;
    } catch {
      // Vite may still be starting.
    }
    await delay(250);
  }
  throw new Error(`Web fixture server did not start on ${appUrl}.\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.killed) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(2000),
  ]);
}

try {
  await waitForServer();
  const result = spawn(
    process.execPath,
    [new URL("./simulations-browser-regression.mjs", import.meta.url)],
    {
      env: {
        ...process.env,
        ENGRAM_BROWSER_TEST_URL: appUrl,
        ENGRAM_BROWSER_DEBUG_PORT: String(debugPort),
      },
      stdio: "inherit",
    },
  );
  const exitCode = await new Promise((resolve) => {
    result.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  process.exitCode = exitCode;
} finally {
  await stopServer();
}