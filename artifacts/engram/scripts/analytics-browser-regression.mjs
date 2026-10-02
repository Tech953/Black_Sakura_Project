import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9231);
const profileDir = await mkdtemp(join(tmpdir(), "engram-analytics-profile-"));

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
  const makeEngram = (id, name, symbol, title, isChatActive, driveId, driveLabel) => ({
    id,
    slug: "fixture-" + id,
    name,
    title,
    symbol,
    origin: "Browser regression fixture",
    voiceProfile: {
      speechStyle: "clear",
      formatting: "plain",
      vocabulary: ["signal"],
      sampleLines: ["A fixture line."],
      narrationStyle: "first-person"
    },
    emotionalBaseline: {
      valence: 0.1,
      arousal: 0.2,
      volatility: 0.1,
      mood: "steady"
    },
    environmentAnchor: {
      name: "Fixture Environment",
      description: "A browser-test environment.",
      locations: ["fixture room"],
      items: ["fixture console"],
      ambient: "quiet"
    },
    memorySeed: {
      relationship: "A test persona.",
      facts: [],
      summary: "An isolated browser fixture."
    },
    guardrails: { framing: "Stay in the fixture.", boundaries: [] },
    drives: [{
      id: driveId,
      label: driveLabel,
      description: "A fixture drive.",
      weight: 1,
      baseRate: 0.01
    }],
    focusThemes: ["focus-" + id],
    autonomyEnabled: true,
    tickCadenceSeconds: 60,
    initiationThreshold: 0.8,
    driveState: { [driveId]: 0.4 },
    currentMood: "steady",
    lastTickAt: "2026-09-13T12:00:00.000Z",
    lastTransmissionAt: null,
    backoffUntil: null,
    isChatActive,
    mode: "companion",
    humanContactEnabled: true,
    simulationEnabled: true,
    artifactGenerationEnabled: true,
    isArchival: false,
    createdAt: "2026-09-13T12:00:00.000Z",
    updatedAt: "2026-09-13T12:00:00.000Z"
  });
  const engrams = [
    makeEngram(1, "Charging Guide", "◇", "Charging fixture", false, "focus", "Focus"),
    makeEngram(2, "Ready Scout", "◆", "Ready fixture", true, "signal", "Signal"),
    makeEngram(3, "Cooldown Keeper", "○", "Cooldown fixture", false, "rest", "Rest"),
    makeEngram(4, "Paused Watcher", "△", "Paused fixture", false, "guard", "Guard")
  ];
  const state = (engramId, overrides = {}) => ({
    engramId,
    autonomyEnabled: true,
    currentMood: "steady",
    initiationThreshold: 0.8,
    tickCadenceSeconds: 60,
    lastTickAt: "2026-09-13T12:00:00.000Z",
    lastTransmissionAt: null,
    backoffUntil: null,
    inBackoff: false,
    cooldownUntil: null,
    inCooldown: false,
    topCharge: 0.4,
    ready: false,
    drives: [{ id: "focus", label: "Focus", pressure: 0.4, weight: 1, charge: 0.4 }],
    ...overrides
  });
  const states = [
    [
      state(1, { topCharge: 0.4, drives: [{ id: "focus", label: "Focus", pressure: 0.4, weight: 1, charge: 0.4 }] }),
      state(2, { topCharge: 0.95, ready: true, drives: [{ id: "signal", label: "Signal", pressure: 0.95, weight: 1, charge: 0.95 }] }),
      state(3, { topCharge: 0.72, ready: true, inCooldown: true, cooldownUntil: "2026-09-13T12:05:00.000Z", drives: [{ id: "rest", label: "Rest", pressure: 0.72, weight: 1, charge: 0.72 }] }),
      state(4, { topCharge: 0.1, inBackoff: true, backoffUntil: "2026-09-13T12:05:00.000Z", drives: [{ id: "guard", label: "Guard", pressure: 0.1, weight: 1, charge: 0.1 }] })
    ],
    [
      state(1, { topCharge: 0.66, ready: true, drives: [{ id: "focus", label: "Focus", pressure: 0.66, weight: 1, charge: 0.66 }] }),
      state(2, { topCharge: 0.95, ready: true, drives: [{ id: "signal", label: "Signal", pressure: 0.95, weight: 1, charge: 0.95 }] }),
      state(3, { topCharge: 0.72, ready: true, inCooldown: true, cooldownUntil: "2026-09-13T12:05:00.000Z", drives: [{ id: "rest", label: "Rest", pressure: 0.72, weight: 1, charge: 0.72 }] }),
      state(4, { topCharge: 0.1, inBackoff: true, backoffUntil: "2026-09-13T12:05:00.000Z", drives: [{ id: "guard", label: "Guard", pressure: 0.1, weight: 1, charge: 0.1 }] })
    ]
  ];
  let stateVersion = 0;
  let stateRequestsFailing = false;
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  window.__analyticsBrowserFixture = {
    pageToken: String(Date.now()) + "-" + String(Math.random()),
    configUpdateRequests: [],
    setStateVersion(version) { stateVersion = version; },
    setStateFailure(value) { stateRequestsFailing = value; },
    getStateVersion() { return stateVersion; }
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")
    ).toUpperCase();
    const pathname = new URL(url, window.location.origin).pathname;
    if (pathname === "/api/engrams" && method === "GET") return response(engrams);
    if (pathname === "/api/engrams/state" && method === "GET") {
      if (stateRequestsFailing) return response({ error: "fixture unavailable" }, 503);
      return response(states[stateVersion]);
    }
    if (/^\/api\/engrams\/\d+\/transmissions$/.test(pathname) && method === "GET") {
      return response([]);
    }
    if (/^\/api\/engrams\/\d+$/.test(pathname) && method === "PATCH") {
      const id = Number(pathname.split("/").at(-1));
      const body = JSON.parse(init.body ?? "{}");
      window.__analyticsBrowserFixture.configUpdateRequests.push({ id, body });
      const index = engrams.findIndex((engram) => engram.id === id);
      if (index < 0) return response({ error: "fixture engram not found" }, 404);
      engrams[index] = { ...engrams[index], ...body };
      return response(engrams[index]);
    }
    if (pathname === "/api/stats" && method === "GET") {
      return response({
        totalMemories: 0,
        totalBeliefs: 0,
        totalJournalEntries: 0,
        totalInitiativeEvents: 0,
        evolutionRevisions: 0,
        memoryByLayer: [],
        initiativeByDay: [],
        beliefConfidenceDistribution: []
      });
    }
    if (pathname === "/api/events") return response({});
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
  const diagnostics = await devtools.evaluate(`({
    url: window.location.href,
    focusThemes: document.querySelector('[data-testid="input-focus-themes"]')?.value ?? null,
    selectedEngrams: Array.from(document.querySelectorAll('[data-testid^="button-select-engram-"]'))
      .filter((element) => element.classList.contains("bg-primary/10"))
      .map((element) => element.getAttribute("data-testid")),
    bodyTail: document.body?.innerText.slice(-500)
  })`);
  throw new Error(`Timed out waiting for ${label}. Browser state: ${JSON.stringify(diagnostics)}`);
}

function statusText(id) {
  return `document.querySelector('[data-testid="pressure-status-${id}"]')?.textContent?.trim()`;
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  const encodedFixture = Buffer.from(fixtureScript).toString("base64");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`
  });

  await devtools.call("Page.navigate", { url: `${appUrl}/analytics` });
  await waitFor(
    "document.querySelectorAll('[data-testid^=\"pressure-roster-item-\"]').length === 4",
    "all pressure roster cards",
  );
  await waitForText("Charging Guide", "charging engram");
  await waitForText("Ready Scout", "ready engram");
  await waitForText("Cooldown Keeper", "cooldown engram");
  await waitForText("Paused Watcher", "paused engram");

  const statuses = await devtools.evaluate(
    `[${[1, 2, 3, 4].map((id) => statusText(id)).join(", ")}]`,
  );
  if (!["Charging", "Ready", "Cooldown", "Paused"].every((label, index) => statuses[index] === label)) {
    throw new Error(`Unexpected pressure status precedence: ${JSON.stringify(statuses)}`);
  }

  const progress = await devtools.evaluate(
    `Object.fromEntries([1, 2, 3, 4].map((id) => [id, document.querySelector('[data-testid="pressure-roster-item-' + id + '"] [role="progressbar"]')?.getAttribute("aria-valuenow")]))`,
  );
  if (JSON.stringify(progress) !== JSON.stringify({ 1: "50", 2: "100", 3: "90", 4: "13" })) {
    throw new Error(`Unexpected threshold-relative pressure values: ${JSON.stringify(progress)}`);
  }

  const initialToken = await devtools.evaluate("window.__analyticsBrowserFixture.pageToken");
  await devtools.call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await waitFor(
    "window.innerWidth === 390 && document.querySelectorAll('[data-testid^=\"pressure-roster-item-\"]').length === 4",
    "all roster cards at narrow width",
  );
  const narrowNames = await devtools.evaluate(
    `Array.from(document.querySelectorAll('[data-testid^="pressure-roster-item-"]')).map((node) => node.innerText)`,
  );
  for (const name of ["Charging Guide", "Ready Scout", "Cooldown Keeper", "Paused Watcher"]) {
    if (!narrowNames.some((cardText) => cardText.toLowerCase().includes(name.toLowerCase()))) {
      throw new Error(`Narrow Analytics view hid ${name}: ${JSON.stringify(narrowNames)}`);
    }
  }
  const narrowStatusCount = await devtools.evaluate(
    `document.querySelectorAll('[data-testid^="pressure-status-"]').length`,
  );
  if (narrowStatusCount !== 4) {
    throw new Error(`Narrow Analytics view hid pressure status chips: ${narrowStatusCount}`);
  }

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(true)");
  await waitFor(
    `document.querySelector('[data-testid="pressure-live-status"]')?.textContent?.toLowerCase().includes("stale")`,
    "Analytics stale pressure warning",
    12000,
  );
  const stalePressure = await devtools.evaluate(
    `document.querySelector('[data-testid="pressure-roster-item-1"]')?.textContent?.includes("0.40 / 0.80 · 50%")`,
  );
  if (!stalePressure) throw new Error("Analytics hid the last pressure value while showing stale state");

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(false)");
  await waitFor(
    "!document.querySelector('[data-testid=\"pressure-live-status\"]')",
    "Analytics stale pressure recovery",
    12000,
  );

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateVersion(1)");
  await waitFor(
    `document.querySelector('[data-testid="pressure-roster-item-1"]')?.textContent?.includes("0.66 / 0.80 · 83%")`,
    "polled pressure refresh",
    12000,
  );
  const refreshed = await devtools.evaluate(`({
    status: ${statusText(1)},
    progress: document.querySelector('[data-testid="pressure-roster-item-1"] [role="progressbar"]')?.getAttribute("aria-valuenow"),
    pageToken: window.__analyticsBrowserFixture.pageToken,
    navigationType: performance.getEntriesByType("navigation")[0]?.type
  })`);
  if (refreshed.status !== "Ready" || refreshed.progress !== "83") {
    throw new Error(`Polling refresh did not update the charging card: ${JSON.stringify(refreshed)}`);
  }
  if (refreshed.pageToken !== initialToken || refreshed.navigationType !== "navigate") {
    throw new Error(`Pressure refresh reloaded the page: ${JSON.stringify(refreshed)}`);
  }

  await clickTestId("button-open-environment-3");
  await waitFor(
    `window.location.pathname === "/environment" &&
      window.location.search === "?engramId=3"`,
    "Environment route and roster query",
  );
  await waitFor(
    `document.querySelector('[data-testid="input-focus-themes"]')?.value === "focus-3" &&
      document.querySelector('[data-testid="button-select-engram-3"]')?.classList.contains("bg-primary/10")`,
    "roster handoff selecting the requested environment",
  );
  const environmentSelection = await devtools.evaluate(`({
    targetSelected: document.querySelector('[data-testid="button-select-engram-3"]')?.classList.contains("bg-primary/10"),
    firstSelected: document.querySelector('[data-testid="button-select-engram-1"]')?.classList.contains("bg-primary/10"),
    activeSelected: document.querySelector('[data-testid="button-select-engram-2"]')?.classList.contains("bg-primary/10"),
    controls: ["switch-autonomy", "button-commit-config", "button-tick", "button-transmit"]
      .map((id) => Boolean(document.querySelector('[data-testid="' + id + '"]')))
  })`);
  if (
    !environmentSelection.targetSelected ||
    environmentSelection.firstSelected ||
    environmentSelection.activeSelected ||
    environmentSelection.controls.some((present) => !present)
  ) {
    throw new Error(
      `Environment did not preserve the roster selection or controls: ${JSON.stringify(environmentSelection)}`,
    );
  }

  await clickTestId("switch-autonomy");
  await waitFor(
    `document.querySelector('[data-testid="switch-autonomy"]')?.getAttribute("aria-checked") === "false"`,
    "Environment autonomy control responding after handoff",
  );
  await clickTestId("button-commit-config");
  await waitFor(
    "window.__analyticsBrowserFixture.configUpdateRequests.length === 1",
    "Environment config commit",
  );
  const configUpdate = await devtools.evaluate(
    "window.__analyticsBrowserFixture.configUpdateRequests[0]",
  );
  if (configUpdate.id !== 3 || configUpdate.body.autonomyEnabled !== false) {
    throw new Error(
      `Environment committed the wrong roster selection: ${JSON.stringify(configUpdate)}`,
    );
  }

  await devtools.evaluate(`(() => {
    window.__analyticsBrowserFixture.setStateVersion(0);
    window.history.back();
  })()`);
  await waitFor(
    `window.location.pathname === "/analytics" &&
      document.querySelectorAll('[data-testid^="pressure-roster-item-"]').length === 4`,
    "returning to Analytics after the environment handoff",
  );
  await waitFor(
    `document.querySelector('[data-testid="pressure-roster-item-1"]')?.textContent?.includes("0.40 / 0.80 · 50%")`,
    "Analytics pressure polling after returning from Environment",
    12000,
  );
  const returnedAnalytics = await devtools.evaluate(`({
    pageToken: window.__analyticsBrowserFixture.pageToken,
    navigationType: performance.getEntriesByType("navigation")[0]?.type,
    pressureStatus: ${statusText(1)}
  })`);
  if (
    returnedAnalytics.pageToken !== initialToken ||
    returnedAnalytics.navigationType !== "navigate" ||
    returnedAnalytics.pressureStatus !== "Charging"
  ) {
    throw new Error(
      `Analytics did not remain usable after the handoff: ${JSON.stringify(returnedAnalytics)}`,
    );
  }

  console.log("Analytics pressure browser regression passed");
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

async function waitForText(text, label) {
  await waitFor(
    `document.body?.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    label,
  );
}

async function clickTestId(testId) {
  const selector = JSON.stringify(`[data-testid="${testId}"]`);
  const point = await devtools.evaluate(`(() => {
    const element = document.querySelector(${selector});
    if (!element) return null;
    element.scrollIntoView({ block: "center", inline: "center" });
    const bounds = element.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`);
  if (!point) throw new Error(`Cannot click missing test target: ${testId}`);

  await devtools.call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
  });
  await devtools.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
  await devtools.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    clickCount: 1,
  });
}