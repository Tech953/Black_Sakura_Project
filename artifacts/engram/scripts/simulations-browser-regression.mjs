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
  #consoleErrors = [];

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
          if (
            message.method === "Runtime.consoleAPICalled" &&
            message.params?.type === "error"
          ) {
            const details = (message.params.args ?? [])
              .map((argument) => argument.value ?? argument.description ?? "")
              .join(" ");
            this.#consoleErrors.push(details || "Browser console error");
          } else if (message.method === "Runtime.exceptionThrown") {
            const details = message.params?.exceptionDetails;
            this.#consoleErrors.push(
              details?.exception?.description ?? details?.text ?? "Browser exception",
            );
          }
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

  consoleErrors() {
    return [...this.#consoleErrors];
  }
}

const devtools = new DevTools();

const fixtureScript = String.raw`
(() => {
  window.__simulationBrowserErrors = [];
  window.addEventListener("error", (event) => {
    window.__simulationBrowserErrors.push(String(event.error?.stack ?? event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__simulationBrowserErrors.push(String(event.reason?.stack ?? event.reason));
  });
  const originalFetch = window.fetch.bind(window);
  const engrams = [
    {
      id: 1,
      name: "Scenario Guide",
      symbol: "◇",
      mode: "simulation",
      simulationEnabled: true,
      humanContactEnabled: true,
      artifactGenerationEnabled: true,
      isArchival: false
    },
    {
      id: 2,
      name: "Route Scout",
      symbol: "◆",
      mode: "simulation",
      simulationEnabled: true,
      humanContactEnabled: true,
      artifactGenerationEnabled: true,
      isArchival: false
    }
  ];
  const rawSimulationNarrative =
    "\n\t first line \u2003\n\n  second line\t" +
    "\u27e1/[]\u2014%# ".repeat(40) +
    " trailing narrative beyond the excerpt";
  const normalizedSimulationExcerpt = rawSimulationNarrative
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  const simulationActivity = {
    id: 901,
    spaceId: 5,
    engramId: 1,
    kind: "simulate",
    summary:
      "Scenario Guide advanced a simulation (step 2/5): " +
      normalizedSimulationExcerpt,
    createdAt: "2026-09-12T12:06:00.000Z"
  };
  const mediaAsset = {
    id: 501,
    engramId: 1,
    conversationId: null,
    filename: "harbor-note.txt",
    mimeType: "text/plain",
    modality: "text",
    sizeBytes: 24,
    status: "completed",
    resultState: "complete",
    summary: "A harbor beacon was recorded.",
    commentary: "The guide recognizes the harbor beacon.",
    transcript: null,
    error: null,
    observationCount: 1,
    startedAt: "2026-09-12T12:10:00.000Z",
    completedAt: "2026-09-12T12:10:01.000Z",
    createdAt: "2026-09-12T12:10:00.000Z",
    updatedAt: "2026-09-12T12:10:01.000Z"
  };
  const processingMediaAsset = {
    ...mediaAsset,
    id: 503,
    filename: "incoming-note.txt",
    status: "processing",
    resultState: "none",
    summary: null,
    commentary: null,
    observationCount: 0,
    completedAt: null,
    updatedAt: "2026-09-12T12:11:00.000Z"
  };
  const recoveredMediaAsset = {
    ...mediaAsset,
    id: 504,
    filename: "recovered-note.txt",
    status: "failed",
    resultState: "none",
    summary: null,
    commentary: null,
    error: "Processing timed out and was recovered.",
    failureKind: "recovered",
    observationCount: 0,
    startedAt: "2026-09-12T12:12:00.000Z",
    completedAt: null,
    createdAt: "2026-09-12T12:12:00.000Z",
    updatedAt: "2026-09-12T12:17:00.000Z"
  };
  const mediaObservations = [{
    id: 601,
    mediaAssetId: 501,
    engramId: 1,
    content: "A harbor beacon was recorded.",
    confidence: 0.94,
    provenance: "observed",
    source: "media:501",
    createdAt: "2026-09-12T12:10:01.000Z"
  }];
  const worldModelEntries = [
    {
      id: 701,
      engramId: 1,
      provenance: "observed",
      content: "A harbor beacon was recorded.",
      confidence: 0.94,
      scope: "private",
      source: "media:501",
      createdAt: "2026-09-12T12:10:01.000Z",
      updatedAt: "2026-09-12T12:10:01.000Z"
    },
    {
      id: 702,
      engramId: 1,
      provenance: "remembered",
      content: "The guide prefers calm routes.",
      confidence: 0.81,
      scope: "private",
      source: "engine",
      createdAt: "2026-09-12T12:09:00.000Z",
      updatedAt: "2026-09-12T12:09:00.000Z"
    },
    {
      id: 703,
      engramId: 1,
      provenance: "observed",
      content: "The original source file was removed after perception.",
      confidence: 0.77,
      scope: "private",
      source: "media:502",
      createdAt: "2026-09-12T12:08:00.000Z",
      updatedAt: "2026-09-12T12:08:00.000Z"
    }
  ];
  const stepSets = new Map([
    [42, [{
      id: 101,
      simulationId: 42,
      stepNumber: 1,
      speakerEngramId: 1,
      narrative: "The vault lights dim, but the guide keeps the route open.",
      worldModelEntryId: 901,
      createdAt: "2026-09-12T12:01:00.000Z"
    }]],
    [43, [
      {
        id: 102,
        simulationId: 43,
        stepNumber: 1,
        speakerEngramId: 1,
        narrative: "The guide marks the safest route through the blackout.",
        worldModelEntryId: 902,
        createdAt: "2026-09-12T12:04:00.000Z"
      },
      {
        id: 103,
        simulationId: 43,
        stepNumber: 2,
        speakerEngramId: 2,
        narrative: "The scout confirms the eastern passage is clear.",
        worldModelEntryId: 903,
        createdAt: "2026-09-12T12:05:00.000Z"
      }
    ]]
  ]);
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
  let simulations = [simulation];
  const createBodies = [];
  const patchBodies = [];
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const currentSimulation = () => ({ ...simulation });
  window.__simulationBrowserFixture = { patchBodies, createBodies };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")
    ).toUpperCase();
    const pathname = new URL(url, window.location.origin).pathname;
    if (pathname === "/api/engrams" && method === "GET") return response(engrams);
    if (pathname === "/api/hub/controls" && method === "GET") {
      return response({ paused: false, quietMode: false });
    }
    if (pathname === "/api/hub/spaces" && method === "GET") return response([]);
    if (pathname === "/api/hub/presence" && method === "GET") return response([]);
    if (pathname === "/api/hub/activity" && method === "GET") {
      return response([simulationActivity]);
    }
    if (pathname === "/api/engrams/messages" && method === "GET") return response([]);
    if (pathname === "/api/events") return response({});
    if (pathname === "/api/engrams/1/world-model" && method === "GET") {
      return response(worldModelEntries);
    }
    if (pathname === "/api/media" && method === "GET") {
      return response([mediaAsset, processingMediaAsset, recoveredMediaAsset]);
    }
    if (pathname === "/api/media/501" && method === "GET") {
      return response({ asset: mediaAsset, observations: mediaObservations });
    }
    if (pathname === "/api/media/504" && method === "GET") {
      return response({ asset: recoveredMediaAsset, observations: [] });
    }
    if (pathname === "/api/simulations" && method === "GET") {
      return response(simulations);
    }
    if (pathname === "/api/simulations" && method === "POST") {
      const body = JSON.parse(init.body ?? "{}");
      createBodies.push(body);
      const shared = {
        ...baseSimulation,
        id: 43,
        participantEngramIds: body.participantEngramIds,
        premise: "What if the guide and scout shared the evacuation plan?",
        status: "proposed",
        currentStep: 0,
        startedAt: null,
        updatedAt: "2026-09-12T12:04:00.000Z"
      };
      simulations = [...simulations, shared];
      return response(shared, 201);
    }
    const stepsMatch = pathname.match(/^\/api\/simulations\/(\d+)\/steps$/);
    if (stepsMatch && method === "GET") {
      return response(stepSets.get(Number(stepsMatch[1])) ?? []);
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
      simulations = simulations.map((candidate) =>
        candidate.id === simulation.id ? simulation : candidate,
      );
      return response(currentSimulation());
    }
    if (pathname === "/api/engrams/1" && method === "PATCH") {
      const body = JSON.parse(init.body ?? "{}");
      patchBodies.push(body);
      if (typeof body.simulationEnabled === "boolean") {
        engrams.find((candidate) => candidate.id === 1).simulationEnabled = body.simulationEnabled;
      }
      return response({ ...engrams.find((candidate) => candidate.id === 1) });
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
  const state = await devtools.evaluate(`JSON.stringify({
    url: location.href,
    title: document.title,
    body: (document.body?.innerText || "").slice(0, 900),
    errors: window.__simulationBrowserErrors ?? []
  })`);
  throw new Error(`Timed out waiting for ${label}: ${state}`);
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

  await click(`document.querySelector('[data-testid="button-sim-engram-2"]')`, "second simulation participant");
  await waitFor(
    `document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "two selected simulation participants",
  );
  await waitForText("2 engrams will alternate turns", "shared participant count");
  await click(`document.querySelector('[data-testid="button-launch-simulation"]')`, "launch shared simulation");
  await waitFor(
    "window.__simulationBrowserFixture.createBodies.length === 1",
    "shared simulation create request",
  );
  const createBody = await devtools.evaluate("window.__simulationBrowserFixture.createBodies[0]");
  if (
    createBody.engramId !== 1 ||
    JSON.stringify(createBody.participantEngramIds) !== JSON.stringify([1, 2])
  ) {
    throw new Error(`Shared simulation request lost participant selection: ${JSON.stringify(createBody)}`);
  }
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"simulation-43\"]'))",
    "shared simulation card",
  );
  await waitForText("What if the guide and scout shared the evacuation plan?", "shared simulation premise");
  const sharedCardText = await devtools.evaluate(
    `document.querySelector('[data-testid="simulation-43"]')?.innerText ?? ""`,
  );
  for (const participant of ["Scenario Guide", "Route Scout"]) {
    if (!sharedCardText.includes(participant)) {
      throw new Error(`Shared simulation card hid ${participant}: ${sharedCardText}`);
    }
  }
  await click(`document.querySelector('[data-testid="button-steps-43"]')`, "shared simulation step log");
  await waitForText("The guide marks the safest route through the blackout.", "guide step narrative");
  await waitForText("The scout confirms the eastern passage is clear.", "scout step narrative");
  const speakerRows = await devtools.evaluate(`({
    guide: document.querySelector('[data-testid="simulation-step-102"]')?.innerText ?? "",
    scout: document.querySelector('[data-testid="simulation-step-103"]')?.innerText ?? ""
  })`);
  if (
    !speakerRows.guide.toLowerCase().includes("scenario guide") ||
    !speakerRows.scout.toLowerCase().includes("route scout")
  ) {
    throw new Error(`Shared step speakers were not rendered: ${JSON.stringify(speakerRows)}`);
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

  await devtools.call("Page.navigate", { url: `${appUrl}/world-model` });
  await waitForText("A harbor beacon was recorded.", "media-backed world-model entry");
  await waitFor("Boolean(document.querySelector('[data-testid=\"media-source-701\"]'))", "media source badge");
  await waitFor("Boolean(document.querySelector('[data-testid=\"link-media-source-701\"]'))", "media source link");
  await waitForText("The guide prefers calm routes.", "non-media world-model entry");
  const nonMediaEntry = await devtools.evaluate(
    `document.querySelector('[data-testid="card-entry-702"]')?.innerText ?? ""`,
  );
  if (nonMediaEntry.includes("MEDIA") || nonMediaEntry.includes("Media")) {
    throw new Error(`Non-media world-model source received a media badge: ${nonMediaEntry}`);
  }

  await click(
    `document.querySelector('[data-testid="link-media-source-701"]')`,
    "media source link",
  );
  await waitFor(
    `location.pathname === "/media" && new URLSearchParams(location.search).get("asset") === "501"`,
    "focused media URL",
  );
  await waitFor("document.querySelector('[data-testid=\"media-501\"]')?.getAttribute('data-focused') === 'true'", "focused media asset");
  await waitFor("Boolean(document.querySelector('[data-testid=\"media-detail-501\"]'))", "expanded media asset");
  await waitForText("harbor-note.txt", "expanded media filename");

  await devtools.call("Page.navigate", { url: `${appUrl}/media?asset=504` });
  await waitFor("Boolean(document.querySelector('[data-testid=\"media-recovery-notice-504\"]'))", "recovered media notice");
  await waitForText("No completed partial result was committed.", "recovered media explanation");
  await waitForText("without creating duplicates.", "recovered retry guidance");

  await devtools.call("Page.navigate", { url: `${appUrl}/dashboard` });
  await waitForText("Recent Perception", "recent perception card");
  await waitForText("A harbor beacon was recorded.", "recent media observation");
  await waitFor("Boolean(document.querySelector('[data-testid=\"link-recent-media-source-701\"]'))", "recent source link");
  await waitFor("Boolean(document.querySelector('[data-testid=\"recent-media-perception-processing\"]'))", "processing media notice");
  await waitFor("Boolean(document.querySelector('[data-testid=\"recent-media-source-deleted-703\"]'))", "deleted media source notice");
  const recentCardText = await devtools.evaluate(
    `document.querySelector('[data-testid="recent-media-perception"]')?.innerText ?? ""`,
  );
  if (!recentCardText.includes("Source asset unavailable")) {
    throw new Error(`Deleted media source state was not explained: ${recentCardText}`);
  }

  const hubConsoleErrorStart = devtools.consoleErrors().length;
  await devtools.call("Page.navigate", { url: `${appUrl}/hub` });
  await waitFor(
    `Boolean(document.querySelector('[data-testid="activity-901"]'))`,
    "simulation activity row in the Hub",
  );
  await devtools.evaluate(
    `document.querySelector('[data-testid="activity-901"]')?.scrollIntoView({ block: "center" })`,
  );
  const activityLayout = await devtools.evaluate(`(() => {
    const row = document.querySelector('[data-testid="activity-901"]');
    const icon = row?.querySelector("svg");
    const summary = row?.querySelector("p");
    const timestamp = row?.querySelector("span");
    if (!row || !icon || !summary || !timestamp) return null;
    const rowRect = row.getBoundingClientRect();
    const summaryRect = summary.getBoundingClientRect();
    const iconRect = icon.getBoundingClientRect();
    const timestampRect = timestamp.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(summary);
    const summaryLineCount = range.getClientRects().length;
    const isVisible = (node, rect) => {
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 &&
        style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) > 0;
    };
    return {
      iconClasses: Array.from(icon.classList),
      iconVisible: isVisible(icon, iconRect),
      summaryText: summary.textContent ?? "",
      summaryVisible: isVisible(summary, summaryRect),
      summaryLineCount,
      summaryClientWidth: summary.clientWidth,
      summaryScrollWidth: summary.scrollWidth,
      summaryClientHeight: summary.clientHeight,
      summaryScrollHeight: summary.scrollHeight,
      summaryBounds: {
        left: summaryRect.left,
        right: summaryRect.right,
        top: summaryRect.top,
        bottom: summaryRect.bottom
      },
      timestampVisible: isVisible(timestamp, timestampRect),
      rowClientWidth: row.clientWidth,
      rowScrollWidth: row.scrollWidth,
      rowBounds: {
        left: rowRect.left,
        right: rowRect.right,
        top: rowRect.top,
        bottom: rowRect.bottom
      },
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  })()`);
  if (!activityLayout) {
    throw new Error("Hub simulation activity row did not render its icon and metadata");
  }
  const simulationSummaryPrefix =
    "Scenario Guide advanced a simulation (step 2/5): ";
  if (!activityLayout.iconClasses.includes("lucide-flask-conical")) {
    throw new Error(
      `Hub simulation activity did not use the FlaskConical icon: ${JSON.stringify(activityLayout.iconClasses)}`,
    );
  }
  if (!activityLayout.iconClasses.includes("text-rose-300")) {
    throw new Error("Hub simulation activity icon lost its simulation color");
  }
  if (!activityLayout.summaryText.startsWith(simulationSummaryPrefix)) {
    throw new Error(
      `Hub hid the engram identity or simulation step metadata: ${activityLayout.summaryText}`,
    );
  }
  const visibleExcerpt = activityLayout.summaryText.slice(simulationSummaryPrefix.length);
  if (
    visibleExcerpt.length !== 180 ||
    !visibleExcerpt.startsWith("first line second line") ||
    !visibleExcerpt.includes("⟡/[]—%#") ||
    /[\r\n\t]/.test(activityLayout.summaryText)
  ) {
    throw new Error(
      `Hub simulation narrative was not rendered as a bounded, normalized excerpt: ${activityLayout.summaryText}`,
    );
  }
  if (
    !activityLayout.iconVisible ||
    !activityLayout.summaryVisible ||
    !activityLayout.timestampVisible
  ) {
    throw new Error(`Hub simulation activity metadata was hidden: ${JSON.stringify(activityLayout)}`);
  }
  if (activityLayout.summaryLineCount < 2) {
    throw new Error("Long Hub simulation narrative did not wrap onto multiple lines");
  }
  if (
    activityLayout.rowScrollWidth > activityLayout.rowClientWidth + 1 ||
    activityLayout.summaryScrollWidth > activityLayout.summaryClientWidth + 1 ||
    activityLayout.summaryScrollHeight > activityLayout.summaryClientHeight + 1
  ) {
    throw new Error(`Hub simulation activity text overflows its row: ${JSON.stringify(activityLayout)}`);
  }
  if (
    activityLayout.rowBounds.left < 0 ||
    activityLayout.rowBounds.right > activityLayout.viewportWidth + 1 ||
    activityLayout.summaryBounds.left < 0 ||
    activityLayout.summaryBounds.right > activityLayout.viewportWidth + 1 ||
    activityLayout.summaryBounds.top < 0 ||
    activityLayout.summaryBounds.bottom > activityLayout.viewportHeight + 1
  ) {
    throw new Error(`Hub simulation activity text is clipped by the viewport: ${JSON.stringify(activityLayout)}`);
  }
  const hubPageErrors = await devtools.evaluate(
    "window.__simulationBrowserErrors ?? []",
  );
  const hubConsoleErrors = devtools.consoleErrors().slice(hubConsoleErrorStart);
  if (hubPageErrors.length || hubConsoleErrors.length) {
    throw new Error(
      `Hub activity browser errors: ${JSON.stringify({ page: hubPageErrors, console: hubConsoleErrors })}`,
    );
  }

  console.log("Simulation, Hub activity layout, and media-memory browser regressions passed");
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