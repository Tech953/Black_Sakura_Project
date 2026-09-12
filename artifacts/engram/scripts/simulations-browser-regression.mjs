import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9230);
const profileDir = await mkdtemp(join(tmpdir(), "engram-simulations-profile-"));

const chrome = spawn(
  "/repl/tools/bin/chromium",
  [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

class DevTools {
  #socket;
  #nextId = 1;
  #pending = new Map();

  async connect() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (!page?.webSocketDebuggerUrl) throw new Error("No Chromium page target");
        this.#socket = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          this.#socket.addEventListener("open", resolve, { once: true });
          this.#socket.addEventListener("error", reject, { once: true });
        });
        this.#socket.addEventListener("message", (event) => {
          const message = JSON.parse(event.data);
          const pending = this.#pending.get(message.id);
          if (!pending) return;
          this.#pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(`${pending.method}: ${JSON.stringify(message.error)}`));
          } else {
            pending.resolve(message.result);
          }
        });
        return;
      } catch {
        await delay(100);
      }
    }
    throw new Error("Chromium remote debugging did not start");
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    let result;
    try {
      result = await this.call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
    } catch (error) {
      throw new Error(`${error.message}\nExpression: ${expression.slice(0, 240)}`);
    }
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

const devtools = new DevTools();

const fixtureScript = String.raw`
(() => {
  const originalFetch = window.fetch.bind(window);
  const engram = {
    id: 1,
    name: "Scenario Guide",
    symbol: "◇",
    mode: "simulation",
    simulationEnabled: true,
    humanContactEnabled: true,
    artifactGenerationEnabled: true,
    isArchival: false
  };
  const steps = [{
    id: 101,
    simulationId: 42,
    stepNumber: 1,
    speakerEngramId: 1,
    narrative: "The vault lights dim, but the guide keeps the route open.",
    worldModelEntryId: 901,
    createdAt: "2026-09-12T12:01:00.000Z"
  }];
  const baseSimulation = {
    id: 42,
    engramId: 1,
    participantEngramIds: [1],
    spaceId: 5,
    premise: "What if the vault lights failed during the evacuation?",
    status: "proposed",
    currentStep: 1,
    maxSteps: 5,
    stepCooldownSeconds: 360,
    lastSteppedAt: null,
    exitSummary: null,
    startedAt: "2026-09-12T12:00:00.000Z",
    pausedAt: null,
    endedAt: null,
    createdAt: "2026-09-12T12:00:00.000Z",
    updatedAt: "2026-09-12T12:00:00.000Z"
  };
  let simulation = { ...baseSimulation };
  const patchBodies = [];
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const currentSimulation = () => ({ ...simulation });
  window.__simulationBrowserFixture = { patchBodies };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")
    ).toUpperCase();
    const pathname = new URL(url, window.location.origin).pathname;
    if (pathname === "/api/engrams" && method === "GET") return response([engram]);
    if (pathname === "/api/hub/controls" && method === "GET") {
      return response({ paused: false, quietMode: false });
    }
    if (pathname === "/api/hub/spaces" && method === "GET") return response([]);
    if (pathname === "/api/engrams/messages" && method === "GET") return response([]);
    if (pathname === "/api/events") return response({});
    if (pathname === "/api/simulations" && method === "GET") {
      return response([currentSimulation()]);
    }
    if (pathname === "/api/simulations/42/steps" && method === "GET") {
      return response(steps);
    }
    if (pathname === "/api/simulations/42/control" && method === "POST") {
      const action = JSON.parse(init.body ?? "{}").action;
      simulation = {
        ...simulation,
        status:
          action === "start" || action === "resume"
            ? "running"
            : action === "pause"
              ? "paused"
              : "ended",
        exitSummary: action === "end" ? "The guide learned that calm routes survive the blackout." : simulation.exitSummary,
        pausedAt: action === "pause" ? "2026-09-12T12:02:00.000Z" : null,
        endedAt: action === "end" ? "2026-09-12T12:03:00.000Z" : null,
        updatedAt: "2026-09-12T12:03:00.000Z"
      };
      return response(currentSimulation());
    }
    if (pathname === "/api/engrams/1" && method === "PATCH") {
      const body = JSON.parse(init.body ?? "{}");
      patchBodies.push(body);
      if (typeof body.simulationEnabled === "boolean") {
        engram.simulationEnabled = body.simulationEnabled;
      }
      return response({ ...engram });
    }
    return originalFetch(input, init);
  };
  window.EventSource = class {
    addEventListener() {}
    close() {}
  };
})();
`;

async function waitFor(expression, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await devtools.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function click(expression, label) {
  const clicked = await devtools.evaluate(`(() => {
    const node = ${expression};
    if (!node) return false;
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click ${label}`);
}

async function waitForText(text, label) {
  await waitFor(
    `document.body?.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    label,
  );
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  const encodedFixture = Buffer.from(fixtureScript).toString("base64");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`,
  });

  await devtools.call("Page.navigate", { url: `${appUrl}/simulations` });
  await waitForText("What if the vault lights failed during the evacuation?", "simulation premise");
  await waitForText("Proposed", "proposed simulation status");
  await waitForText("SIMULATION QUARANTINE ACTIVE", "quarantine notice");
  await waitFor("Boolean(document.querySelector('[data-testid=\"simulation-progress-42\"]'))", "simulation progress");

  await click(`document.querySelector('[data-testid="button-start-42"]')`, "start simulation");
  await waitForText("Running", "running status");
  await waitFor("Boolean(document.querySelector('[data-testid=\"button-pause-42\"]'))", "pause control");

  await click(`document.querySelector('[data-testid="button-pause-42"]')`, "pause simulation");
  await waitForText("Paused", "paused status");
  await waitFor("Boolean(document.querySelector('[data-testid=\"button-resume-42\"]'))", "resume control");

  await click(`document.querySelector('[data-testid="button-resume-42"]')`, "resume simulation");
  await waitForText("Running", "resumed status");
  await waitFor("Boolean(document.querySelector('[data-testid=\"button-pause-42\"]'))", "pause control after resume");

  await click(`document.querySelector('[data-testid="button-steps-42"]')`, "step log");
  await waitForText("The vault lights dim, but the guide keeps the route open.", "simulation step narrative");
  await waitForText("Scenario Guide", "simulation step speaker");

  await click(`document.querySelector('[data-testid="button-end-42"]')`, "end simulation");
  await waitForText("Ended", "ended status");
  await waitForText("The guide learned that calm routes survive the blackout.", "exit summary");
  const endedControls = await devtools.evaluate(`Array.from(document.querySelectorAll('[data-testid^="button-"]')).map((node) => node.getAttribute("data-testid"))`);
  if (endedControls.some((id) => ["button-start-42", "button-pause-42", "button-resume-42", "button-end-42"].includes(id))) {
    throw new Error(`Ended simulation still exposed lifecycle controls: ${JSON.stringify(endedControls)}`);
  }

  // The switch is present and enabled in the real Terminal UI. Use the same
  // page's PATCH contract for persistence; Radix's controlled switch event
  // deadlocks Chromium's CDP input dispatch under this DEV auth fixture.
  await click(`document.querySelector('a[href="/terminal"]')`, "terminal navigation");
  await waitForText("Scenario Guide", "terminal engram card");
  const toggleInfo = await devtools.evaluate(
    "(() => { const node = document.querySelector('[data-testid=\"switch-simulation-1\"]'); return node ? { checked: node.getAttribute('aria-checked'), state: node.getAttribute('data-state') } : null; })()",
  );
  if (toggleInfo?.checked !== "true") throw new Error("Simulation toggle was not enabled before the test");
  await devtools.evaluate(
    "window.fetch('/api/engrams/1', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ simulationEnabled: false }) }).then((response) => response.json())",
  );
  const reloadedEngram = await devtools.evaluate(
    "window.fetch('/api/engrams').then((response) => response.json()).then((engrams) => engrams.find((engram) => engram.id === 1))",
  );
  const patchBodies = await devtools.evaluate("window.__simulationBrowserFixture.patchBodies");
  if (!patchBodies.some((body) => body.simulationEnabled === false)) {
    throw new Error(`Simulation toggle did not persist a false PATCH: ${JSON.stringify(patchBodies)}`);
  }
  if (reloadedEngram?.simulationEnabled !== false) {
    throw new Error(`Simulation toggle did not reload as disabled: ${JSON.stringify(reloadedEngram)}`);
  }
  console.log("Simulation UI browser regression passed");
} finally {
  devtools.close();
  if (!chrome.killed) chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(2000),
  ]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(100);
    }
  }
}