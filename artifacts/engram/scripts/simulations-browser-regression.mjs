import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  cleanupDisposableClerkSession,
  createDisposableClerkSession,
} from "./real-clerk-browser-session.mjs";

const realClerkMode = process.env.ENGRAM_BROWSER_REAL_CLERK === "true";
const explicitAppUrl = process.env.ENGRAM_BROWSER_TEST_URL;
if (realClerkMode && !explicitAppUrl && !process.env.REPLIT_DEV_DOMAIN) {
  throw new Error(
    "Real Clerk simulation checks require ENGRAM_BROWSER_TEST_URL or REPLIT_DEV_DOMAIN",
  );
}
const appUrl = (
  explicitAppUrl ??
  (realClerkMode
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5188")
).replace(/\/+$/, "");
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9230);
const profileDir = await mkdtemp(join(tmpdir(), "engram-simulations-profile-"));
let disposableClerk;

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
      if (!error.message?.includes("Inspected target navigated or closed")) {
        throw new Error(`${error.message}\nExpression: ${expression.slice(0, 240)}`);
      }
      this.#socket?.close();
      this.#socket = undefined;
      await this.connect();
      result = await this.call("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
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
      isArchival: false,
      isChatActive: true
    },
    {
      id: 2,
      name: "Route Scout",
      symbol: "◆",
      mode: "simulation",
      simulationEnabled: true,
      humanContactEnabled: true,
      artifactGenerationEnabled: true,
      isArchival: false,
      isChatActive: false
    },
    {
      id: 4,
      name: "Quiet Surveyor",
      symbol: "○",
      mode: "simulation",
      simulationEnabled: true,
      humanContactEnabled: true,
      artifactGenerationEnabled: true,
      isArchival: false,
      isChatActive: false
    }
  ];
  const archivalEngram = {
    id: 3,
    name: "Archived Guide",
    symbol: "▣",
    mode: "simulation",
    simulationEnabled: false,
    humanContactEnabled: false,
    artifactGenerationEnabled: false,
    isArchival: true
  };
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
  const routeScoutMediaAsset = {
    ...mediaAsset,
    id: 511,
    engramId: 2,
    filename: "north-pass.txt",
    summary: "A route marker was recorded.",
    commentary: "The scout found the north pass.",
    observationCount: 1,
    createdAt: "2026-09-12T12:14:00.000Z",
    updatedAt: "2026-09-12T12:14:01.000Z"
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
  const routeScoutProcessingAsset = {
    ...processingMediaAsset,
    id: 512,
    engramId: 2,
    filename: "queued-map.txt"
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
  const routeScoutObservations = [{
    id: 611,
    mediaAssetId: 511,
    engramId: 2,
    content: "A route marker was recorded.",
    confidence: 0.91,
    provenance: "observed",
    source: "media:511",
    createdAt: "2026-09-12T12:14:01.000Z"
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
    },
    {
      id: 707,
      engramId: 1,
      provenance: "inferred",
      content: "The eastern passage stays marked safe.",
      confidence: 0.73,
      scope: "shared",
      createdAt: "2026-09-12T12:07:30.000Z",
      updatedAt: "2026-09-12T12:07:30.000Z"
    },
    {
      id: 704,
      engramId: 1,
      provenance: "remembered",
      content: "A Rebecca source-authority memory.",
      confidence: 0.92,
      scope: "private",
      source: "seed:rebecca-adaptive:v1:primary-dialogue:edgerunners-dialogue-asr",
      createdAt: "2026-09-12T12:07:00.000Z",
      updatedAt: "2026-09-12T12:07:00.000Z"
    },
    {
      id: 706,
      engramId: 1,
      provenance: "inferred",
      content: "This entry was deleted by another operator.",
      confidence: 0.63,
      scope: "private",
      source: "engine",
      createdAt: "2026-09-12T12:06:00.000Z",
      updatedAt: "2026-09-12T12:06:00.000Z"
    }
  ];
  const routeScoutWorldModelEntries = [{
    id: 708,
    engramId: 2,
    provenance: "observed",
    content: "A route marker was recorded.",
    confidence: 0.91,
    scope: "private",
    source: "media:511",
    createdAt: "2026-09-12T12:14:01.000Z",
    updatedAt: "2026-09-12T12:14:01.000Z"
  }];
  const quietSurveyorWorldModelEntries = [{
    id: 709,
    engramId: 4,
    provenance: "remembered",
    content: "The surveyor keeps paper charts.",
    confidence: 0.86,
    scope: "private",
    source: "engine",
    createdAt: "2026-09-12T12:13:00.000Z",
    updatedAt: "2026-09-12T12:13:00.000Z"
  }];
  const worldModelStorageKey = "engram:simulations-browser:world-model-entries";
  const storedWorldModelEntries = localStorage.getItem(worldModelStorageKey);
  let currentWorldModelEntries = storedWorldModelEntries
    ? JSON.parse(storedWorldModelEntries)
    : [...worldModelEntries];
  const archivalWorldModelEntries = [{
    id: 705,
    engramId: 3,
    provenance: "remembered",
    content: "The archived guide's route remains protected.",
    confidence: 0.88,
    scope: "private",
    source: "engine",
    createdAt: "2026-09-12T12:05:00.000Z",
    updatedAt: "2026-09-12T12:05:00.000Z"
  }];
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
  const worldModelPatchBodies = [];
  const fixtureInstanceId = crypto.randomUUID();
  const writeRequests = [];
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const currentSimulation = () => ({ ...simulation });
  window.__simulationBrowserFixture = {
    patchBodies,
    createBodies,
    worldModelPatchBodies,
    writeRequests,
    engrams,
    instanceId: fixtureInstanceId
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")
    ).toUpperCase();
    const pathname = new URL(url, window.location.origin).pathname;
    if (method !== "GET" && method !== "HEAD") {
      writeRequests.push({ pathname, method });
    }
    if (pathname === "/api/engrams" && method === "GET") {
      return response(
        window.location.pathname === "/world-model"
          ? [...engrams, archivalEngram]
          : engrams,
      );
    }
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
      return response(currentWorldModelEntries);
    }
    if (pathname === "/api/engrams/2/world-model" && method === "GET") {
      return response(routeScoutWorldModelEntries);
    }
    if (pathname === "/api/engrams/4/world-model" && method === "GET") {
      return response(quietSurveyorWorldModelEntries);
    }
    if (pathname === "/api/engrams/3/world-model" && method === "GET") {
      return response(archivalWorldModelEntries);
    }
    const worldModelEntryMatch = pathname.match(
      /^\/api\/engrams\/(\d+)\/world-model\/(\d+)$/,
    );
    if (worldModelEntryMatch && method === "PATCH") {
      const engramId = Number(worldModelEntryMatch[1]);
      const entryId = Number(worldModelEntryMatch[2]);
      const body = JSON.parse(init.body ?? "{}");
      worldModelPatchBodies.push({ engramId, entryId, body });
      const existing = currentWorldModelEntries.find(
        (entry) => entry.id === entryId && entry.engramId === engramId,
      );
      if (!existing) {
        return response({ error: "World-model entry not found" }, 404);
      }
      const updated = {
        ...existing,
        ...body,
        updatedAt: "2026-09-12T12:20:00.000Z"
      };
      currentWorldModelEntries = currentWorldModelEntries.map((entry) =>
        entry.id === entryId && entry.engramId === engramId ? updated : entry,
      );
      localStorage.setItem(
        worldModelStorageKey,
        JSON.stringify(currentWorldModelEntries),
      );
      return response(updated);
    }
    if (worldModelEntryMatch && method === "DELETE") {
      const engramId = Number(worldModelEntryMatch[1]);
      const entryId = Number(worldModelEntryMatch[2]);
      if (engramId === 1 && entryId === 704) {
        return response({
          error: "Rebecca source-authority memories are seed-managed and cannot be created, changed, or deleted through the API."
        }, 409);
      }
      if (engramId === 3 && entryId === 705) {
        return response({ error: "Archival engrams are read-only." }, 403);
      }
      if (engramId === 1 && entryId === 706) {
        currentWorldModelEntries = currentWorldModelEntries.filter(
          (entry) => entry.id !== entryId,
        );
        return response({ error: "World-model entry not found" }, 404);
      }
      return response({ error: "World-model entry not found" }, 404);
    }
    if (pathname === "/api/media" && method === "GET") {
      const engramId = new URL(url, window.location.origin).searchParams.get(
        "engramId",
      );
      const assets = [
        mediaAsset,
        processingMediaAsset,
        recoveredMediaAsset,
        routeScoutMediaAsset,
        routeScoutProcessingAsset,
      ];
      return response(
        engramId === null
          ? assets
          : assets.filter((asset) => asset.engramId === Number(engramId)),
      );
    }
    if (pathname === "/api/media/501" && method === "GET") {
      return response({ asset: mediaAsset, observations: mediaObservations });
    }
    if (pathname === "/api/media/511" && method === "GET") {
      return response({
        asset: routeScoutMediaAsset,
        observations: routeScoutObservations,
      });
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

const realClerkAuditScript = String.raw`
(() => {
  window.__simulationBrowserErrors = [];
  window.__simulationBrowserPatchAudit = [];
  window.addEventListener("error", (event) => {
    window.__simulationBrowserErrors.push(String(event.error?.stack ?? event.message));
  });
  window.addEventListener("unhandledrejection", (event) => {
    window.__simulationBrowserErrors.push(String(event.reason?.stack ?? event.reason));
  });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    const method = String(init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const pathMatch = url.pathname.match(/^\/api\/engrams\/(\d+)$/);
    if (!pathMatch || method !== "PATCH") return originalFetch(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    let requestBody = init.body;
    if (requestBody == null && input instanceof Request) {
      try {
        requestBody = await input.clone().text();
      } catch {}
    }
    let requestedSimulationEnabled = null;
    try {
      requestedSimulationEnabled = JSON.parse(requestBody ?? "{}").simulationEnabled ?? null;
    } catch {}

    const response = await originalFetch(input, init);
    let responseSimulationEnabled = null;
    try {
      responseSimulationEnabled = (await response.clone().json()).simulationEnabled ?? null;
    } catch {}
    window.__simulationBrowserPatchAudit.push({
      path: url.pathname,
      method,
      status: response.status,
      requestedSimulationEnabled,
      responseSimulationEnabled,
      hasBearer: /^Bearer\s+\S+$/i.test(headers.get("authorization") ?? ""),
    });
    return response;
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
    readyState: document.readyState,
    bodyHtml: (document.body?.innerHTML || "").slice(0, 600),
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

async function pressKey(key) {
  await devtools.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key,
    code: key,
  });
  await devtools.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    code: key,
  });
}

async function waitForText(text, label) {
  await waitFor(
    `document.body?.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    label,
  );
}

async function reloadFixtureDocument(label) {
  const previousInstance = await devtools.evaluate(
    "window.__simulationBrowserFixture.instanceId",
  );
  await devtools.call("Page.reload");
  await waitFor(
    `window.__simulationBrowserFixture?.instanceId && window.__simulationBrowserFixture.instanceId !== ${JSON.stringify(previousInstance)}`,
    label,
  );
}

async function withTimeout(promise, label, timeoutMs = 5000) {
  let timeoutId;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timed out during ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function evaluateReal(expression, label, timeoutMs = 5000) {
  return withTimeout(devtools.evaluate(expression), `browser evaluation (${label})`, timeoutMs);
}

async function callReal(method, params, label, timeoutMs = 5000) {
  return withTimeout(devtools.call(method, params), `browser command (${label})`, timeoutMs);
}

async function waitForReal(expression, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluateReal(expression, label, 3000)) return;
    } catch {
      // A navigation can briefly invalidate a Runtime evaluation; keep waiting.
    }
    await delay(150);
  }
  const state = await evaluateReal(
    "JSON.stringify({ path: location.pathname, title: document.title, readyState: document.readyState })",
    `${label} diagnostic`,
    2000,
  ).catch(() => "browser unavailable");
  throw new Error(`Timed out waiting for ${label}: ${state}`);
}

async function clickSwitchWithRealPointer(selector) {
  const bounds = await evaluateReal(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: "center", inline: "center" });
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
      role: node.getAttribute("role"),
      checked: node.getAttribute("aria-checked"),
      disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true",
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  })()`, "simulation switch pointer target");
  if (
    !bounds ||
    bounds.role !== "switch" ||
    bounds.checked === null ||
    bounds.disabled ||
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.x >= bounds.viewportWidth ||
    bounds.y >= bounds.viewportHeight
  ) {
    throw new Error("The simulation control was not an enabled, visible switch");
  }

  const event = { x: bounds.x, y: bounds.y };
  await callReal("Input.dispatchMouseEvent", { type: "mouseMoved", ...event }, "pointer move");
  await callReal(
    "Input.dispatchMouseEvent",
    { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, ...event },
    "pointer press",
  );
  await callReal(
    "Input.dispatchMouseEvent",
    { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, ...event },
    "pointer release",
  );
  return bounds.checked === "true";
}

async function runRealClerkRegression() {
  disposableClerk = await createDisposableClerkSession();
  await callReal(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: realClerkAuditScript },
    "install request audit",
  );

  const signInUrl =
    `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(disposableClerk.signInToken)}`;
  await callReal("Page.navigate", { url: signInUrl }, "open disposable Clerk session");
  await waitForReal(
    "location.pathname === '/dashboard' && Boolean(window.Clerk?.user?.id)",
    "disposable Clerk sign-in",
  );
  const signedInUserId = await evaluateReal(
    "window.Clerk?.user?.id ?? null",
    "confirm signed-in user",
  );
  if (signedInUserId !== disposableClerk.userId) {
    throw new Error("The browser did not sign in as the disposable Clerk user");
  }

  const account = await evaluateReal(`(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch("/api/engrams", {
      headers: { Authorization: "Bearer " + token }
    });
    const body = await response.json();
    return {
      status: response.status,
      rows: Array.isArray(body) ? body.map((engram) => ({
        id: engram.id,
        simulationEnabled: engram.simulationEnabled,
        isArchival: engram.isArchival
      })) : null
    };
  })()`, "load disposable account engrams");
  if (account.status !== 200 || !Array.isArray(account.rows)) {
    throw new Error(`Authenticated engram listing returned HTTP ${account.status}`);
  }
  const targetEngram = account.rows.find(
    (engram) =>
      Number.isSafeInteger(engram.id) &&
      engram.isArchival !== true &&
      typeof engram.simulationEnabled === "boolean",
  );
  if (!targetEngram) {
    throw new Error("The disposable Clerk account has no editable engrams");
  }

  await callReal(
    "Page.navigate",
    { url: `${appUrl}/simulations` },
    "open simulations route",
  );
  await waitForReal(
    "location.pathname === '/simulations' && Boolean(document.querySelector('h2')?.textContent?.trim())",
    "signed-in simulations route",
  );
  const simulationsRequest = await evaluateReal(`(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch("/api/simulations", {
      headers: { Authorization: "Bearer " + token }
    });
    const body = await response.json();
    return { status: response.status, isList: Array.isArray(body) };
  })()`, "check authenticated simulations API");
  if (simulationsRequest.status !== 200 || !simulationsRequest.isList) {
    throw new Error(
      `Signed-in simulations API returned HTTP ${simulationsRequest.status}`,
    );
  }

  await callReal("Page.navigate", { url: `${appUrl}/terminal` }, "open Terminal route");
  const selector = `[data-testid="switch-simulation-${targetEngram.id}"]`;
  await waitForReal(
    `(() => { const node = document.querySelector(${JSON.stringify(selector)}); return Boolean(node && node.getAttribute("aria-checked") !== null); })()`,
    "editable simulation switch on Terminal",
  );
  const initialState = await evaluateReal(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    return node ? {
      checked: node.getAttribute("aria-checked"),
      disabled: node.disabled === true || node.getAttribute("aria-disabled") === "true"
    } : null;
  })()`, "read initial switch state");
  const initialEnabled = targetEngram.simulationEnabled;
  if (
    !initialState ||
    initialState.checked !== String(initialEnabled) ||
    initialState.disabled
  ) {
    throw new Error("Terminal did not render the editable simulation state from the API");
  }

  const desiredEnabled = !initialEnabled;
  await clickSwitchWithRealPointer(selector);
  await waitForReal(
    `(window.__simulationBrowserPatchAudit ?? []).some((request) =>
      request.path === "/api/engrams/${targetEngram.id}" &&
      request.method === "PATCH" &&
      request.status === 200 &&
      request.requestedSimulationEnabled === ${desiredEnabled} &&
      request.responseSimulationEnabled === ${desiredEnabled} &&
      request.hasBearer)`,
    "successful authenticated UI PATCH",
  );
  const patchAudit = await evaluateReal(
    `(window.__simulationBrowserPatchAudit ?? []).findLast((request) => request.path === "/api/engrams/${targetEngram.id}" && request.method === "PATCH") ?? null`,
    "read simulation PATCH audit",
  );
  if (
    patchAudit?.status !== 200 ||
    patchAudit.requestedSimulationEnabled !== desiredEnabled ||
    patchAudit.responseSimulationEnabled !== desiredEnabled ||
    patchAudit.hasBearer !== true
  ) {
    throw new Error("The UI did not send the expected authenticated simulation PATCH");
  }

  await waitForReal(
    `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === "${desiredEnabled}"`,
    "Terminal switch updated after PATCH",
  );
  const persistedState = await evaluateReal(`(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch("/api/engrams", {
      headers: { Authorization: "Bearer " + token }
    });
    const rows = await response.json();
    const engram = Array.isArray(rows) ? rows.find((row) => row.id === ${targetEngram.id}) : null;
    return {
      status: response.status,
      simulationEnabled: engram?.simulationEnabled ?? null
    };
  })()`, "verify persisted simulation state");
  if (
    persistedState.status !== 200 ||
    persistedState.simulationEnabled !== desiredEnabled
  ) {
    throw new Error("The authenticated engram list did not persist the switch change");
  }

  await callReal("Page.reload", {}, "refresh Terminal after PATCH");
  await waitForReal(
    `location.pathname === '/terminal' &&
      window.Clerk?.user?.id === ${JSON.stringify(disposableClerk.userId)} &&
      document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-checked") === "${desiredEnabled}"`,
    "refreshed Terminal simulation state",
  );
  const pageErrors = await evaluateReal(
    "window.__simulationBrowserErrors ?? []",
    "read browser errors",
  );
  if (pageErrors.length > 0) {
    throw new Error(`Real Clerk simulation browser errors: ${JSON.stringify(pageErrors)}`);
  }

  console.log(
    `Real Clerk simulations and Terminal browser check passed: engram ${targetEngram.id}, authenticated PATCH and refreshed state verified`,
  );
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  if (realClerkMode) {
    await runRealClerkRegression();
  } else {
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

  const originalViewport = await devtools.evaluate(
    "({ width: window.innerWidth, height: window.innerHeight })",
  );
  await devtools.call("Emulation.setDeviceMetricsOverride", {
    width: 375,
    height: 812,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await waitFor(
    "window.innerWidth === 375 && window.innerHeight === 812",
    "narrow 375x812 simulation viewport",
  );
  const participantLayout = await devtools.evaluate(`(() => {
    const first = document.querySelector('[data-testid="button-sim-engram-1"]');
    const second = document.querySelector('[data-testid="button-sim-engram-2"]');
    first?.parentElement?.scrollIntoView({ block: "center" });
    const measure = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        visible: node.getClientRects().length > 0,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        disabled: node.disabled === true
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      first: measure(first),
      second: measure(second)
    };
  })()`);
  const participantFitsViewport = (option) =>
    option?.visible &&
    option.width > 0 &&
    option.left >= 0 &&
    option.right <= participantLayout.viewport.width + 1 &&
    option.top >= 0 &&
    option.bottom <= participantLayout.viewport.height + 1 &&
    option.scrollWidth <= option.clientWidth + 1 &&
    !option.disabled;
  if (
    participantLayout.viewport.width !== 375 ||
    participantLayout.pageWidth > participantLayout.viewport.width + 1 ||
    !participantFitsViewport(participantLayout.first) ||
    !participantFitsViewport(participantLayout.second)
  ) {
    throw new Error(
      `Simulation participant controls are clipped or overflow at 375px: ${JSON.stringify(participantLayout)}`,
    );
  }

  await click(`document.querySelector('[data-testid="button-sim-engram-2"]')`, "second simulation participant");
  await waitFor(
    `document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "two selected simulation participants",
  );
  await click(`document.querySelector('[data-testid="button-sim-engram-1"]')`, "first simulation participant");
  await waitFor(
    `!document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "first participant deselection at narrow width",
  );
  await click(`document.querySelector('[data-testid="button-sim-engram-1"]')`, "reselect first simulation participant");
  await waitFor(
    `document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "first participant selection at narrow width",
  );
  await click(`document.querySelector('[data-testid="button-sim-engram-2"]')`, "second participant deselection");
  await waitFor(
    `document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     !document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "second participant deselection at narrow width",
  );
  await click(`document.querySelector('[data-testid="button-sim-engram-2"]')`, "reselect second simulation participant");
  await waitFor(
    `document.querySelector('[data-testid="button-sim-engram-1"]')?.textContent?.includes("✓") &&
     document.querySelector('[data-testid="button-sim-engram-2"]')?.textContent?.includes("✓")`,
    "participant selection restored at narrow width",
  );
  await waitForText("2 engrams will alternate turns", "shared participant count");
  await devtools.evaluate(
    "document.querySelector('[data-testid=\"button-launch-simulation\"]')?.scrollIntoView({ block: 'center' })",
  );
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
  const sharedCardLayout = await devtools.evaluate(`(() => {
    const card = document.querySelector('[data-testid="simulation-43"]');
    const participants = document.querySelector('[data-testid="simulation-participants-43"]');
    card?.scrollIntoView({ block: "center" });
    const measure = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        visible: node.getClientRects().length > 0,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      card: measure(card),
      participants: {
        ...measure(participants),
        text: participants?.textContent ?? ""
      }
    };
  })()`);
  const fitsNarrowWidth = (node, viewportWidth) =>
    node?.visible &&
    node.width > 0 &&
    node.left >= 0 &&
    node.right <= viewportWidth + 1 &&
    node.scrollWidth <= node.clientWidth + 1;
  if (
    sharedCardLayout.viewport.width !== 375 ||
    sharedCardLayout.pageWidth > sharedCardLayout.viewport.width + 1 ||
    !fitsNarrowWidth(sharedCardLayout.card, sharedCardLayout.viewport.width) ||
    !fitsNarrowWidth(sharedCardLayout.participants, sharedCardLayout.viewport.width) ||
    !sharedCardLayout.participants.text.includes("Scenario Guide") ||
    !sharedCardLayout.participants.text.includes("Route Scout")
  ) {
    throw new Error(
      `Shared participant names overflow or are unavailable at 375px: ${JSON.stringify(sharedCardLayout)}`,
    );
  }
  const sharedCardText = await devtools.evaluate(
    `document.querySelector('[data-testid="simulation-43"]')?.innerText ?? ""`,
  );
  for (const participant of ["Scenario Guide", "Route Scout"]) {
    if (!sharedCardText.includes(participant)) {
      throw new Error(`Shared simulation card hid ${participant}: ${sharedCardText}`);
    }
  }
  await devtools.evaluate(
    "document.querySelector('[data-testid=\"button-steps-43\"]')?.scrollIntoView({ block: 'center' })",
  );
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
  const narrowStepLayout = await devtools.evaluate(`(() => {
    const measure = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        visible: node.getClientRects().length > 0,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth
      };
    };
    const rows = [
      { id: 102, narrative: "The guide marks the safest route through the blackout.", speaker: "Scenario Guide" },
      { id: 103, narrative: "The scout confirms the eastern passage is clear.", speaker: "Route Scout" }
    ].map((expected) => {
      const row = document.querySelector('[data-testid="simulation-step-' + expected.id + '"]');
      row?.scrollIntoView({ block: "center" });
      const narrative = document.querySelector('[data-testid="simulation-step-narrative-' + expected.id + '"]');
      const speaker = document.querySelector('[data-testid="simulation-step-speaker-' + expected.id + '"]');
      return {
        expected,
        row: measure(row),
        narrative: { ...measure(narrative), text: narrative?.textContent?.trim() ?? "" },
        speaker: { ...measure(speaker), text: speaker?.textContent ?? "" }
      };
    });
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      rows
    };
  })()`);
  const stepContentFits = (node) =>
    node?.visible &&
    node.width > 0 &&
    node.left >= 0 &&
    node.right <= narrowStepLayout.viewport.width + 1 &&
    node.scrollWidth <= node.clientWidth + 1;
  if (
    narrowStepLayout.viewport.width !== 375 ||
    narrowStepLayout.pageWidth > narrowStepLayout.viewport.width + 1 ||
    narrowStepLayout.rows.length !== 2 ||
    narrowStepLayout.rows.some(
      ({ expected, row, narrative, speaker }) =>
        !row?.visible ||
        row.top < 0 ||
        row.bottom > narrowStepLayout.viewport.height + 1 ||
        !stepContentFits(narrative) ||
        !stepContentFits(speaker) ||
        !narrative.text.includes(expected.narrative) ||
        !speaker.text.toLowerCase().includes(expected.speaker.toLowerCase()),
    )
  ) {
    throw new Error(
      `Shared simulation step content clips or overflows at 375px: ${JSON.stringify(narrowStepLayout)}`,
    );
  }
  await devtools.call("Emulation.clearDeviceMetricsOverride");
  await waitFor(
    `window.innerWidth === ${originalViewport.width} && window.innerHeight === ${originalViewport.height}`,
    "restore desktop viewport",
  );
  await devtools.evaluate("window.scrollTo({ top: 0, behavior: 'instant' })");
  console.log("Narrow simulation participant, card, and step layouts passed at 375px");

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
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"card-entry-707\"]'))",
    "source-less world-model entry",
  );
  const sourceLessDisplay = await devtools.evaluate(`(() => {
    const card = document.querySelector('[data-testid="card-entry-707"]');
    return {
      text: card?.innerText ?? "",
      hasMediaBadge: Boolean(document.querySelector('[data-testid="media-source-707"]')),
      hasMediaLink: Boolean(document.querySelector('[data-testid="link-media-source-707"]'))
    };
  })()`);
  if (
    !sourceLessDisplay.text.includes("The eastern passage stays marked safe.") ||
    !sourceLessDisplay.text.toUpperCase().includes("INFERRED") ||
    !sourceLessDisplay.text.toUpperCase().includes("SHARED") ||
    !sourceLessDisplay.text.includes("73%") ||
    sourceLessDisplay.text.includes("undefined") ||
    sourceLessDisplay.text.includes("null") ||
    sourceLessDisplay.hasMediaBadge ||
    sourceLessDisplay.hasMediaLink
  ) {
    throw new Error(`Source-less world-model entry rendered incorrectly: ${JSON.stringify(sourceLessDisplay)}`);
  }
  const editResult = await devtools.evaluate(`window.fetch(
    "/api/engrams/1/world-model/707",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "The eastern passage remains safe after review.",
        confidence: 0.79
      })
    }
  ).then(async (response) => ({ status: response.status, entry: await response.json() }))`);
  const editBody = await devtools.evaluate(
    "window.__simulationBrowserFixture.worldModelPatchBodies.at(-1)",
  );
  if (
    editResult?.status !== 200 ||
    editResult.entry?.content !== "The eastern passage remains safe after review." ||
    Object.hasOwn(editResult.entry ?? {}, "source") ||
    Object.hasOwn(editBody?.body ?? {}, "source")
  ) {
    throw new Error(`Editing the source-less entry changed its source state: ${JSON.stringify({ editResult, editBody })}`);
  }
  await reloadFixtureDocument("source-less world-model page refresh");
  await waitForText(
    "The eastern passage remains safe after review.",
    "edited source-less entry after refresh",
  );
  const refreshedSourceLessState = await devtools.evaluate(`window.fetch(
    "/api/engrams/1/world-model"
  ).then((response) => response.json()).then((entries) => {
    const entry = entries.find((candidate) => candidate.id === 707);
    const card = document.querySelector('[data-testid="card-entry-707"]');
    return {
      entry,
      text: card?.innerText ?? "",
      hasMediaBadge: Boolean(document.querySelector('[data-testid="media-source-707"]')),
      hasMediaLink: Boolean(document.querySelector('[data-testid="link-media-source-707"]'))
    };
  })`);
  if (
    !refreshedSourceLessState.entry ||
    Object.hasOwn(refreshedSourceLessState.entry, "source") ||
    refreshedSourceLessState.entry.content !== "The eastern passage remains safe after review." ||
    !refreshedSourceLessState.text.includes("The eastern passage remains safe after review.") ||
    refreshedSourceLessState.text.includes("undefined") ||
    refreshedSourceLessState.text.includes("null") ||
    refreshedSourceLessState.hasMediaBadge ||
    refreshedSourceLessState.hasMediaLink
  ) {
    throw new Error(`Refreshing the edited source-less entry changed its source state: ${JSON.stringify(refreshedSourceLessState)}`);
  }
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"card-entry-704\"]'))",
    "Rebecca source-authority entry",
  );
  await click(
    `document.querySelector('[data-testid="button-delete-entry-704"]')`,
    "reserved-source delete",
  );
  await waitForText(
    "This memory is managed by Rebecca's source authority and cannot be deleted here.",
    "reserved-source protection message",
  );
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"card-entry-704\"]'))",
    "reserved-source entry remains visible",
  );

  await click(
    `document.querySelector('[data-testid="select-engram-3"]')`,
    "archival engram selector",
  );
  await waitForText(
    "The archived guide's route remains protected.",
    "archival world-model entry",
  );
  await click(
    `document.querySelector('[data-testid="button-delete-entry-705"]')`,
    "archival delete",
  );
  await waitForText(
    "This engram is archived. Its world-model entries are read-only.",
    "archival protection message",
  );
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"card-entry-705\"]'))",
    "archived entry remains visible",
  );

  await click(
    `document.querySelector('[data-testid="select-engram-1"]')`,
    "return to active engram",
  );
  await waitForText("This entry was deleted by another operator.", "stale world-model entry");
  await click(
    `document.querySelector('[data-testid="button-delete-entry-706"]')`,
    "not-found delete",
  );
  await waitForText(
    "This entry is no longer available. The world model is refreshing.",
    "not-found protection message",
  );
  await waitFor(
    "!document.querySelector('[data-testid=\"card-entry-706\"]')",
    "stale entry removed after world-model refresh",
  );

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

  await waitFor(
    `Boolean(document.querySelector('[data-testid="select-recent-perception-engram"]'))`,
    "Recent Perception engram selector",
  );
  const perceptionSelectorIsLabeled = await devtools.evaluate(
    `(() => {
      const selector = document.querySelector('[data-testid="select-recent-perception-engram"]');
      return selector instanceof HTMLSelectElement &&
        selector.labels?.[0]?.textContent.trim().length > 0;
    })()`,
  );
  if (!perceptionSelectorIsLabeled) {
    throw new Error("Recent Perception selector has no accessible label");
  }
  const writesBeforePerceptionSelection = await devtools.evaluate(
    "window.__simulationBrowserFixture.writeRequests.length",
  );
  await devtools.evaluate(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.focus()`,
  );
  await pressKey("ArrowDown");
  await waitFor(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.value === "2"`,
    "keyboard selection of Route Scout",
  );
  await waitFor(
    `document.querySelector('[data-testid="recent-media-perception"]')?.innerText.includes("Route Scout") &&
      Boolean(document.querySelector('[data-testid="recent-media-observation-708"]'))`,
    "Route Scout name and observation update together",
  );
  await waitFor(
    "Boolean(document.querySelector('[data-testid=\"recent-media-perception-processing\"]'))",
    "selected engram processing notice",
  );
  await waitFor(
    "!document.querySelector('[data-testid=\"recent-media-observation-701\"]')",
    "previous engram observations removed",
  );

  await pressKey("ArrowDown");
  await waitFor(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.value === "4"`,
    "keyboard selection of Quiet Surveyor",
  );
  await waitFor(
    `document.querySelector('[data-testid="recent-media-perception"]')?.innerText.includes("Quiet Surveyor") &&
      Boolean(document.querySelector('[data-testid="recent-media-perception-empty"]'))`,
    "empty state for selected engram",
  );
  await waitFor(
    `document.querySelector('[data-testid="recent-media-perception-empty"]')?.textContent.trim() ===
      "No media observations recorded yet"`,
    "localized Recent Perception empty message",
  );
  await waitFor(
    `!document.querySelector('[data-testid="recent-media-perception-processing"]')`,
    "empty engram has no processing banner",
  );
  await waitFor(
    `!document.querySelector('[data-testid="recent-media-observation-701"]') &&
      !document.querySelector('[data-testid="recent-media-observation-708"]')`,
    "empty engram has no media observations",
  );

  await devtools.call("Page.navigate", { url: `${appUrl}/world-model` });
  await waitFor(
    `Boolean(document.querySelector('[data-testid="select-engram-4"]'))`,
    "Quiet Surveyor in the full world-model selector",
  );
  await click(
    `document.querySelector('[data-testid="select-engram-4"]')`,
    "Quiet Surveyor full world-model view",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="card-entry-709"]')) &&
      document.querySelector('[data-testid="card-entry-709"]')?.innerText.includes("The surveyor keeps paper charts.")`,
    "non-media world-model activity remains visible",
  );

  await devtools.call("Page.navigate", { url: `${appUrl}/dashboard` });
  await waitFor(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.value === "1" &&
      Boolean(document.querySelector('[data-testid="recent-media-observation-701"]'))`,
    "dashboard returns to the chat-active engram",
  );
  await devtools.evaluate(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.focus()`,
  );
  await pressKey("ArrowDown");
  await waitFor(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.value === "2" &&
      Boolean(document.querySelector('[data-testid="recent-media-observation-708"]'))`,
    "return to Route Scout by keyboard",
  );

  const engramWritesAfterPerceptionSelection = await devtools.evaluate(
    "window.__simulationBrowserFixture.writeRequests.length",
  );
  if (engramWritesAfterPerceptionSelection !== writesBeforePerceptionSelection) {
    throw new Error("Changing the Recent Perception engram sent an API write");
  }
  const chatActiveEngramIds = await devtools.evaluate(
    `window.__simulationBrowserFixture.engrams
      .filter((engram) => engram.isChatActive)
      .map((engram) => engram.id)
      .join(",")`,
  );
  if (chatActiveEngramIds !== "1") {
    throw new Error(`Recent Perception changed chat-active engrams: ${chatActiveEngramIds}`);
  }
  await click(
    `document.querySelector('[data-testid="link-recent-media-source-708"]')`,
    "Route Scout source link",
  );
  await waitFor(
    `location.pathname === "/media" && new URLSearchParams(location.search).get("asset") === "511"`,
    "Route Scout source asset URL",
  );
  await waitFor(
    `document.querySelector('[data-testid="media-511"]')?.getAttribute("data-focused") === "true"`,
    "focused Route Scout source asset",
  );
  await waitFor("Boolean(document.querySelector('[data-testid=\"media-detail-511\"]'))", "expanded Route Scout source asset");
  await waitForText("north-pass.txt", "Route Scout source filename");

  await devtools.call("Page.navigate", { url: `${appUrl}/dashboard` });
  await waitFor(
    `document.querySelector('[data-testid="select-recent-perception-engram"]')?.value === "1" &&
      Boolean(document.querySelector('[data-testid="recent-media-observation-701"]'))`,
    "dashboard continues to follow the unchanged chat-active engram",
  );

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
  }
} finally {
  let cleanupError;
  devtools.close();
  if (!chrome.killed) chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(2000),
  ]);
  if (realClerkMode && disposableClerk) {
    try {
      await cleanupDisposableClerkSession(appUrl, disposableClerk);
    } catch (error) {
      cleanupError = error;
      console.error(error instanceof Error ? error.message : "Disposable account cleanup failed");
    }
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(profileDir, { recursive: true, force: true });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(100);
    }
  }
  if (cleanupError) throw cleanupError;
}