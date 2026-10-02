import { mkdtemp, readFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9231);
const testLanguage = process.env.ENGRAM_BROWSER_TEST_LANGUAGE ?? "en";
if (!["en", "ar"].includes(testLanguage)) {
  throw new Error(`Unsupported Analytics browser test language: ${testLanguage}`);
}
const localeFile = testLanguage === "ar"
  ? "../../../lib/i18n/src/generated/ar.json"
  : "../../../lib/i18n/src/en/analytics.json";
const localeResources = JSON.parse(await readFile(new URL(localeFile, import.meta.url), "utf8"));
const analyticsTranslations = localeResources.analytics ?? localeResources;
const environmentLocaleFile = testLanguage === "ar"
  ? "../../../lib/i18n/src/generated/ar.json"
  : "../../../lib/i18n/src/en/environment.json";
const environmentLocaleResources = JSON.parse(
  await readFile(new URL(environmentLocaleFile, import.meta.url), "utf8"),
);
const environmentTranslations = environmentLocaleResources.environment ?? environmentLocaleResources;
const expectedStatuses = [
  analyticsTranslations.statusCharging,
  analyticsTranslations.statusReady,
  analyticsTranslations.statusCooldown,
  analyticsTranslations.statusPaused,
];
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
  localStorage.setItem("engram.uiLang", ${JSON.stringify(testLanguage)});
  const originalFetch = window.fetch.bind(window);
  const makeEngram = (id, name, symbol, title, isChatActive, driveId, driveLabel, initiationThreshold) => ({
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
    initiationThreshold,
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
    makeEngram(1, "Charging Guide", "◇", "Charging fixture", false, "focus", "Focus", 0.7),
    makeEngram(2, "Ready Scout", "◆", "Ready fixture", true, "signal", "Signal", 1.1),
    makeEngram(3, "Cooldown Keeper", "○", "Cooldown fixture", false, "rest", "Rest", 0.9),
    makeEngram(4, "Paused Watcher", "△", "Paused fixture", false, "guard", "Guard", 0.6)
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
  await waitFor(
    `document.documentElement.lang === ${JSON.stringify(testLanguage)} &&
      document.documentElement.dir === ${JSON.stringify(testLanguage === "ar" ? "rtl" : "ltr")}`,
    "selected Analytics locale and text direction",
  );
  await waitForText("Charging Guide", "charging engram");
  await waitForText("Ready Scout", "ready engram");
  await waitForText("Cooldown Keeper", "cooldown engram");
  await waitForText("Paused Watcher", "paused engram");

  const statuses = await devtools.evaluate(
    `[${[1, 2, 3, 4].map((id) => statusText(id)).join(", ")}]`,
  );
  if (!expectedStatuses.every((label, index) => statuses[index] === label)) {
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
  const narrowPressureCards = await devtools.evaluate(`({
    lang: document.documentElement.lang,
    direction: document.documentElement.dir,
    width: window.innerWidth,
    cards: [1, 2, 3, 4].map((id) => {
      const card = document.querySelector('[data-testid="pressure-roster-item-' + id + '"]');
      const name = document.querySelector('[data-testid="pressure-name-' + id + '"]');
      const status = document.querySelector('[data-testid="pressure-status-' + id + '"]');
      const label = document.querySelector('[data-testid="pressure-label-' + id + '"]');
      const value = document.querySelector('[data-testid="pressure-value-' + id + '"]');
      const action = document.querySelector('[data-testid="button-open-environment-' + id + '"]');
      const cardBounds = card?.getBoundingClientRect();
      const fits = (element) => {
        if (!element || !cardBounds) return false;
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.left >= cardBounds.left - 1 &&
          bounds.right <= cardBounds.right + 1 &&
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1;
      };
      const nameBounds = name?.getBoundingClientRect();
      const statusBounds = status?.getBoundingClientRect();
      return {
        name: name?.textContent?.trim(),
        status: status?.textContent?.trim(),
        label: label?.textContent?.trim(),
        value: value?.textContent?.trim(),
        progress: card?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"),
        actionText: action?.innerText?.trim(),
        actionLabel: action?.getAttribute("aria-label"),
        actionHref: action?.getAttribute("href"),
        nameFits: fits(name),
        statusFits: fits(status),
        labelFits: fits(label),
        valueFits: fits(value),
        actionFits: fits(action),
        nameAndStatusDoNotOverlap: Boolean(
          nameBounds && statusBounds &&
          (nameBounds.right <= statusBounds.left + 1 || statusBounds.right <= nameBounds.left + 1)
        ),
        valueDirection: value?.getAttribute("dir")
      };
    })
  })`);
  const expectedNames = ["Charging Guide", "Ready Scout", "Cooldown Keeper", "Paused Watcher"];
  const expectedValues = [
    "0.40 / 0.80 · 50%",
    "0.95 / 0.80 · 100%",
    "0.72 / 0.80 · 90%",
    "0.10 / 0.80 · 13%",
  ];
  const expectedProgress = ["50", "100", "90", "13"];
  if (
    narrowPressureCards.lang !== testLanguage ||
    narrowPressureCards.direction !== (testLanguage === "ar" ? "rtl" : "ltr") ||
    narrowPressureCards.width !== 390 ||
    narrowPressureCards.cards.length !== 4 ||
    narrowPressureCards.cards.some((card, index) =>
      card.name !== expectedNames[index] ||
      card.status !== expectedStatuses[index] ||
      card.label !== analyticsTranslations.pressure ||
      card.value !== expectedValues[index] ||
      card.progress !== expectedProgress[index] ||
      card.actionText !== analyticsTranslations.openEnvironment.toUpperCase() ||
      card.actionLabel !== analyticsTranslations.openEnvironment ||
      card.actionHref !== `/environment?engramId=${index + 1}` ||
      !card.nameFits ||
      !card.statusFits ||
      !card.labelFits ||
      !card.valueFits ||
      !card.actionFits ||
      !card.nameAndStatusDoNotOverlap ||
      card.valueDirection !== "ltr"
    )
  ) {
    throw new Error(`Narrow Analytics pressure cards were unreadable or misassociated: ${JSON.stringify(narrowPressureCards)}`);
  }

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(true)");
  await waitFor(
    `document.querySelector('[data-testid="pressure-live-status"]')?.textContent?.includes(${JSON.stringify(analyticsTranslations.pressureLiveStale)})`,
    "Analytics stale pressure warning",
    12000,
  );
  const unavailablePressure = await devtools.evaluate(`({
    warning: document.querySelector('[data-testid="pressure-live-status"]')?.textContent?.trim(),
    warningDirection: (() => {
      const warning = document.querySelector('[data-testid="pressure-live-status"]');
      return warning ? getComputedStyle(warning).direction : null;
    })(),
    warningFitsViewport: (() => {
      const warning = document.querySelector('[data-testid="pressure-live-status"]');
      const bounds = warning?.getBoundingClientRect();
      return Boolean(
        warning && bounds &&
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= 0 &&
        bounds.right <= window.innerWidth &&
        warning.scrollWidth <= warning.clientWidth + 1
      );
    })(),
    cardCount: document.querySelectorAll('[data-testid^="pressure-roster-item-"]').length,
    names: ["Charging Guide", "Ready Scout", "Cooldown Keeper", "Paused Watcher"].map((name, index) =>
      document.querySelector('[data-testid="pressure-roster-item-' + (index + 1) + '"]')
        ?.textContent?.includes(name) ?? false
    ),
    statuses: [${[1, 2, 3, 4].map((id) => statusText(id)).join(", ")}],
    unavailableLabels: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-roster-item-' + id + '"]')
        ?.textContent?.includes(${JSON.stringify(analyticsTranslations.pressureUnavailable)}) ?? false
    ),
    values: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-value-' + id + '"]')?.textContent?.trim()
    ),
    progressBars: document.querySelectorAll('[data-testid^="pressure-roster-item-"] [role="progressbar"]').length,
    pageToken: window.__analyticsBrowserFixture.pageToken
  })`);
  const persistedThresholdValues = ["— / 0.70 · —%", "— / 1.10 · —%", "— / 0.90 · —%", "— / 0.60 · —%"];
  if (
    unavailablePressure.warning !== analyticsTranslations.pressureLiveStale ||
    unavailablePressure.warningDirection !== (testLanguage === "ar" ? "rtl" : "ltr") ||
    !unavailablePressure.warningFitsViewport ||
    unavailablePressure.warning.length > 48 ||
    unavailablePressure.cardCount !== 4 ||
    unavailablePressure.names.some((visible) => !visible) ||
    unavailablePressure.statuses.some((status) => status !== analyticsTranslations.statusPaused) ||
    unavailablePressure.unavailableLabels.some((visible) => !visible) ||
    JSON.stringify(unavailablePressure.values) !== JSON.stringify(persistedThresholdValues) ||
    unavailablePressure.progressBars !== 0 ||
    unavailablePressure.pageToken !== initialToken
  ) {
    throw new Error(`Analytics pressure failure state was not safely degraded: ${JSON.stringify(unavailablePressure)}`);
  }

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(false)");
  await waitFor(
    `!document.querySelector('[data-testid="pressure-live-status"]') &&
      document.querySelector('[data-testid="pressure-value-1"]')?.textContent?.includes("0.40 / 0.80 · 50%") &&
      document.querySelector('[data-testid="pressure-roster-item-1"] [role="progressbar"]')?.getAttribute("aria-valuenow") === "50"`,
    "Analytics stale pressure recovery",
    12000,
  );
  const recoveredPressure = await devtools.evaluate(`({
    values: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-value-' + id + '"]')?.textContent?.trim()
    ),
    statuses: [${[1, 2, 3, 4].map((id) => statusText(id)).join(", ")}],
    progress: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-roster-item-' + id + '"] [role="progressbar"]')
        ?.getAttribute("aria-valuenow")
    ),
    pageToken: window.__analyticsBrowserFixture.pageToken,
    navigationType: performance.getEntriesByType("navigation")[0]?.type
  })`);
  const expectedRecoveredValues = [
    "0.40 / 0.80 · 50%",
    "0.95 / 0.80 · 100%",
    "0.72 / 0.80 · 90%",
    "0.10 / 0.80 · 13%",
  ];
  if (
    JSON.stringify(recoveredPressure.values) !== JSON.stringify(expectedRecoveredValues) ||
    JSON.stringify(recoveredPressure.statuses) !== JSON.stringify(expectedStatuses) ||
    JSON.stringify(recoveredPressure.progress) !== JSON.stringify(["50", "100", "90", "13"]) ||
    recoveredPressure.pageToken !== initialToken ||
    recoveredPressure.navigationType !== "navigate"
  ) {
    throw new Error(`Analytics did not restore live pressure without a reload: ${JSON.stringify(recoveredPressure)}`);
  }

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateVersion(1)");
  await waitFor(
    `document.querySelector('[data-testid="pressure-roster-item-1"]')?.textContent?.includes("0.66 / 0.80 · 83%")`,
    "polled pressure refresh",
    12000,
  );
  const refreshed = await devtools.evaluate(`({
    values: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-value-' + id + '"]')?.textContent?.trim()
    ),
    statuses: [${[1, 2, 3, 4].map((id) => statusText(id)).join(", ")}],
    progress: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-roster-item-' + id + '"] [role="progressbar"]')
        ?.getAttribute("aria-valuenow")
    ),
    names: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="pressure-name-' + id + '"]')?.textContent?.trim()
    ),
    actions: [1, 2, 3, 4].map((id) =>
      document.querySelector('[data-testid="button-open-environment-' + id + '"]')?.getAttribute("href")
    ),
    pageToken: window.__analyticsBrowserFixture.pageToken,
    navigationType: performance.getEntriesByType("navigation")[0]?.type
  })`);
  const expectedPolledValues = [
    "0.66 / 0.80 · 83%",
    "0.95 / 0.80 · 100%",
    "0.72 / 0.80 · 90%",
    "0.10 / 0.80 · 13%",
  ];
  const expectedPolledStatuses = [
    analyticsTranslations.statusReady,
    analyticsTranslations.statusReady,
    analyticsTranslations.statusCooldown,
    analyticsTranslations.statusPaused,
  ];
  if (
    JSON.stringify(refreshed.values) !== JSON.stringify(expectedPolledValues) ||
    JSON.stringify(refreshed.statuses) !== JSON.stringify(expectedPolledStatuses) ||
    JSON.stringify(refreshed.progress) !== JSON.stringify(["83", "100", "90", "13"]) ||
    JSON.stringify(refreshed.names) !== JSON.stringify(expectedNames) ||
    JSON.stringify(refreshed.actions) !== JSON.stringify([1, 2, 3, 4].map((id) => `/environment?engramId=${id}`))
  ) {
    throw new Error(`Polling refresh changed the wrong Analytics card: ${JSON.stringify(refreshed)}`);
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

  await waitFor(
    `document.querySelector('[data-testid="live-state-panel"]') &&
      !document.querySelector('[data-testid="live-state-status"]') &&
      document.querySelector('[data-testid="badge-cooldown"]') &&
      document.querySelector('[data-testid="live-drive-charge-rest"]')?.textContent?.trim() === "0.72" &&
      document.querySelector('[data-testid="live-drive-progress-rest"]')?.style.width === "80%"`,
    "Environment live-state panel with cached drive values",
    12000,
  );
  const environmentToken = await devtools.evaluate("window.__analyticsBrowserFixture.pageToken");
  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(true)");
  await waitFor(
    `document.querySelector('[data-testid="live-state-status"]')?.textContent?.includes(${JSON.stringify(environmentTranslations.liveStateStale)})`,
    "Environment stale live-state warning",
    20000,
  );
  const staleEnvironmentState = await devtools.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="live-state-panel"]');
    const warning = document.querySelector('[data-testid="live-state-status"]');
    const panelBounds = panel?.getBoundingClientRect();
    const warningBounds = warning?.getBoundingClientRect();
    return {
      panelTitle: panel?.querySelector("h3")?.textContent?.trim(),
      warning: warning?.textContent?.trim(),
      warningDirection: warning ? getComputedStyle(warning).direction : null,
      warningFitsPanel: Boolean(
        panelBounds && warningBounds &&
        warningBounds.width > 0 &&
        warningBounds.height > 0 &&
        warningBounds.left >= panelBounds.left - 1 &&
        warningBounds.right <= panelBounds.right + 1 &&
        warningBounds.left >= 0 &&
        warningBounds.right <= window.innerWidth &&
        warning.scrollWidth <= warning.clientWidth + 1
      ),
      cooldownBadgeVisible: Boolean(panel?.querySelector('[data-testid="badge-cooldown"]')),
      charge: panel?.querySelector('[data-testid="live-drive-charge-rest"]')?.textContent?.trim(),
      progress: panel?.querySelector('[data-testid="live-drive-progress-rest"]')?.style.width,
      tickAvailable: Boolean(panel?.querySelector('[data-testid="button-tick"]')),
      transmitAvailable: Boolean(panel?.querySelector('[data-testid="button-transmit"]')),
      pageToken: window.__analyticsBrowserFixture.pageToken
    };
  })()`);
  if (
    staleEnvironmentState.panelTitle !== environmentTranslations.liveState ||
    !staleEnvironmentState.warning?.includes(environmentTranslations.liveStateStale) ||
    staleEnvironmentState.warningDirection !== (testLanguage === "ar" ? "rtl" : "ltr") ||
    staleEnvironmentState.warning.length > 48 ||
    !staleEnvironmentState.warningFitsPanel ||
    !staleEnvironmentState.cooldownBadgeVisible ||
    staleEnvironmentState.charge !== "0.72" ||
    staleEnvironmentState.progress !== "80%" ||
    !staleEnvironmentState.tickAvailable ||
    !staleEnvironmentState.transmitAvailable ||
    staleEnvironmentState.pageToken !== environmentToken
  ) {
    throw new Error(`Environment lost readable cached live state during polling failure: ${JSON.stringify(staleEnvironmentState)}`);
  }

  await devtools.evaluate("window.__analyticsBrowserFixture.setStateFailure(false)");
  await waitFor(
    `!document.querySelector('[data-testid="live-state-status"]') &&
      document.querySelector('[data-testid="live-drive-charge-rest"]')?.textContent?.trim() === "0.72" &&
      document.querySelector('[data-testid="live-drive-progress-rest"]')?.style.width === "80%"`,
    "Environment live-state recovery",
    12000,
  );
  const recoveredEnvironmentState = await devtools.evaluate(`({
    warningPresent: Boolean(document.querySelector('[data-testid="live-state-status"]')),
    cooldownBadgeVisible: Boolean(document.querySelector('[data-testid="live-state-panel"] [data-testid="badge-cooldown"]')),
    charge: document.querySelector('[data-testid="live-drive-charge-rest"]')?.textContent?.trim(),
    progress: document.querySelector('[data-testid="live-drive-progress-rest"]')?.style.width,
    pageToken: window.__analyticsBrowserFixture.pageToken,
    navigationType: performance.getEntriesByType("navigation")[0]?.type
  })`);
  if (
    recoveredEnvironmentState.warningPresent ||
    !recoveredEnvironmentState.cooldownBadgeVisible ||
    recoveredEnvironmentState.charge !== "0.72" ||
    recoveredEnvironmentState.progress !== "80%" ||
    recoveredEnvironmentState.pageToken !== environmentToken ||
    recoveredEnvironmentState.navigationType !== "navigate"
  ) {
    throw new Error(`Environment did not clear stale warning without reloading: ${JSON.stringify(recoveredEnvironmentState)}`);
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

  console.log(`Analytics pressure browser regression passed (${testLanguage})`);
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