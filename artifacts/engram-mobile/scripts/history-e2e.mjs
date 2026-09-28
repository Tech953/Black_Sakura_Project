#!/usr/bin/env node

import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const mobileRoot = path.resolve(new URL("..", import.meta.url).pathname);
const scenario = process.argv.find((arg) => arg.startsWith("--scenario="))?.split("=")[1] ?? "history";
const nativeExportMode = process.env.MOBILE_NATIVE_EXPORT_E2E === "true";

async function reserveEphemeralPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve an ephemeral port for the browser regression");
  }
  return {
    port: address.port,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

if (!["history", "hub-environment"].includes(scenario)) {
  throw new Error(`Unknown browser regression scenario: ${scenario}`);
}

const [appPortReservation, cdpPortReservation] = await Promise.all([
  reserveEphemeralPort(),
  reserveEphemeralPort(),
]);
const port = appPortReservation.port;
const cdpPort = cdpPortReservation.port;
await Promise.all([appPortReservation.close(), cdpPortReservation.close()]);
const appUrl = `http://127.0.0.1:${port}`;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // The dev server is still starting.
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}`);
  return response.json();
}

function cdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 0;
  const pending = new Map();
  const events = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      events.push(message);
      return;
    }
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  async function call(method, params = {}) {
    await ready;
    const id = ++nextId;
    const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async function evaluate(expression) {
    const result = await call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed");
    }
    return result.result?.value;
  }

  return { call, evaluate, events, close: () => socket.close() };
}

const browserMock = String.raw`(() => {
  const engram = {
    id: 1,
    slug: "e2e-persona",
    name: "E2E Persona",
    title: "History regression persona",
    symbol: "◎",
    currentMood: "focused",
    autonomyEnabled: true,
    isArchival: false,
    emotionalBaseline: { mood: "focused", valence: 0.2, arousal: 0.4, volatility: 0.2 },
    drives: [],
    driveState: {},
    initiationThreshold: 1,
    origin: "Browser regression fixture",
    voiceProfile: {
      speechStyle: "direct",
      formatting: "plain",
      vocabulary: [],
      sampleLines: [],
      narrationStyle: "concise",
    },
    environmentAnchor: {
      name: "E2E room",
      description: "A deterministic browser-test setting.",
      locations: [],
      items: [],
      ambient: "quiet",
    },
    memorySeed: {
      relationship: "browser regression fixture",
      facts: [],
      summary: "A deterministic browser-test persona.",
    },
    guardrails: {
      framing: "fictional",
      boundaries: [],
    },
    focusThemes: [],
    tickCadenceSeconds: 60,
    isChatActive: true,
    mode: "social",
    humanContactEnabled: true,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    createdAt: "2026-09-10T12:00:00.000Z",
    updatedAt: "2026-09-10T12:00:00.000Z",
  };
  const messages = {
    101: [
      { id: 1, conversationId: 101, role: "user", content: "Current transcript", createdAt: "2026-09-10T12:00:00.000Z" },
      { id: 2, conversationId: 101, role: "assistant", content: "Current response", createdAt: "2026-09-10T12:00:01.000Z" },
    ],
    102: [
      { id: 3, conversationId: 102, role: "user", content: "Hydrated history message — Café 你好 Привет مرحبا नमस्ते שלום Γειά σου", createdAt: "2026-09-10T12:01:00.000Z" },
      { id: 4, conversationId: 102, role: "assistant", content: "Hydrated history response — Café 你好 Привет مرحبا नमस्ते שלום Γειά σου", createdAt: "2026-09-10T12:01:01.000Z" },
    ],
  };
  const conversations = new Map([
    [101, { id: 101, title: "Current transcript", mode: "companion", engramId: 1, engramIds: [1], groupContinuationMode: "off", createdAt: "2026-09-10T12:00:00.000Z", archivedAt: null }],
    [102, { id: 102, title: "Hydrated history", mode: "companion", engramId: 1, engramIds: [1], groupContinuationMode: "off", createdAt: "2026-09-10T12:01:00.000Z", archivedAt: null }],
  ]);
  window.__historyE2E = { conversations, messages, shares: [], downloads: [], archiveRequests: [], requests: [] };
  window.__hubEnvironmentE2E = { emptyResponses: [] };
  const nativeExportFiles = new Map();
  window.__historyE2E.nativeExport = { attempts: 0, shares: [], deleted: [], files: nativeExportFiles };
  window.__engramNativeChatExportE2E = {
    cacheDirectory: "e2e-native-cache/",
    writeAsStringAsync: async (uri, contents) => {
      nativeExportFiles.set(uri, contents);
    },
    printToFileAsync: async () => {
      const uri = "e2e-native-cache/transcript.pdf";
      nativeExportFiles.set(uri, "native pdf fixture");
      return { uri };
    },
    getInfoAsync: async (uri) => {
      const contents = nativeExportFiles.get(uri);
      return contents == null
        ? { exists: false }
        : { exists: true, size: String(contents).length };
    },
    deleteAsync: async (uri) => {
      window.__historyE2E.nativeExport.deleted.push(uri);
      nativeExportFiles.delete(uri);
    },
    shareAsync: async (uri) => {
      window.__historyE2E.nativeExport.attempts += 1;
      if (window.__historyE2E.nativeExport.attempts === 1) {
        throw new Error("native share failed");
      }
      window.__historyE2E.nativeExport.shares.push(uri);
    },
    dialogTitle: "Share conversation",
  };
  const response = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
    const emptyList = (name) => {
      window.__hubEnvironmentE2E.emptyResponses.push(name);
      return response([]);
    };
  const conversationWithMessages = (id) => ({
    ...conversations.get(id),
    messages: messages[id] ?? [],
  });
  const realFetch = window.fetch.bind(window);
  const downloadBlobs = new Map();
  let downloadId = 0;
  URL.createObjectURL = (blob) => {
    const url = "blob:e2e-" + (++downloadId);
    downloadBlobs.set(url, blob);
    return url;
  };
  const realAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    const url = this.getAttribute("href") ?? this.href;
    const blob = this.download ? downloadBlobs.get(url) : null;
    if (!blob) return realAnchorClick.call(this);
    blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let pdfBase64 = null;
      if (blob.type === "application/pdf") {
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        pdfBase64 = btoa(binary);
      }
      window.__historyE2E.downloads.push({
        filename: this.download,
        type: blob.type,
        size: blob.size,
        prefix: Array.from(bytes.slice(0, 8)),
        hasJpegImage: bytes.some((byte, index) => byte === 0xff && bytes[index + 1] === 0xd8),
        hasToUnicodeMap: new TextDecoder().decode(bytes).includes("/ToUnicode"),
        hasInvisibleTextLayer: new TextDecoder().decode(bytes).includes("3 Tr"),
        hasCjkMapping: new TextDecoder().decode(bytes).includes("<4F60>"),
        pdfBase64,
      });
    });
  };
  window.navigator.share = async (payload) => {
    window.__historyE2E.shares.push(payload);
  };
  window.fetch = async (input, init = {}) => {
    const raw = typeof input === "string" ? input : input.url;
    const url = new URL(raw, window.location.href);
    const path = url.pathname;
    const method = String(init.method ?? "GET").toUpperCase();
    window.__historyE2E.requests.push({ path, method });
    if (path.endsWith("/api/healthz")) return response({ status: "ok" });
    if (path.endsWith("/api/mobile/offline-sync")) {
      return response({ syncedIds: [], imported: { conversations: 0, messages: 0, inquiries: 0, transmissions: 0, observedEntries: 0 } });
    }
    if (path === "/api/engrams/state" && method === "GET") return emptyList("telemetry");
    if (path === "/api/hub/spaces" && method === "GET") return emptyList("spaces");
    if (path === "/api/hub/presence" && method === "GET") return emptyList("presence");
    if (path === "/api/hub/activity" && method === "GET") return emptyList("activity");
    if (path === "/api/simulations" && method === "GET") return emptyList("simulations");
    if (path === "/api/messages" && method === "GET") return emptyList("humanMessages");
    if (path === "/api/memories" && method === "GET") return emptyList("memories");
    if (path === "/api/beliefs" && method === "GET") return emptyList("beliefs");
    if (/^\/api\/engrams\/\d+\/world-model$/.test(path) && method === "GET") {
      return emptyList("worldModel");
    }
    if (path === "/api/media" && method === "GET") return emptyList("media");
    if (path === "/api/hub/controls" && method === "GET") {
      return response({ paused: false, quietMode: false });
    }
    if (path.endsWith("/api/engrams") && method === "GET") return response([engram]);
    if (path.endsWith("/api/engrams/999") && method === "GET") {
      return response({ error: "not found" }, 404);
    }
    if (path.endsWith("/api/engrams/1") && method === "GET") return response(engram);
    if (path.endsWith("/api/engrams/1/activate") && method === "POST") return response(engram);
    if (path.endsWith("/api/openai/conversations") && method === "POST") {
      return response(conversations.get(101), 201);
    }
    if (path.endsWith("/api/openai/conversations") && method === "GET") {
      const archived = url.searchParams.get("archived") === "true";
      return response([...conversations.values()].filter((item) => (item.archivedAt != null) === archived));
    }
    const detail = path.match(/\/api\/openai\/conversations\/(\d+)$/);
    if (detail && method === "GET") {
      const id = Number(detail[1]);
      return conversations.has(id) ? response(conversationWithMessages(id)) : response({ error: "not found" }, 404);
    }
    const archive = path.match(/\/api\/openai\/conversations\/(\d+)\/archive$/);
    if (archive && method === "PATCH") {
      const id = Number(archive[1]);
      const body = JSON.parse(init.body ?? "{}");
      const current = conversations.get(id);
      if (!current) return response({ error: "not found" }, 404);
      const updated = { ...current, archivedAt: body.archived ? "2026-09-10T12:30:00.000Z" : null };
      conversations.set(id, updated);
      window.__historyE2E.archiveRequests.push({ id, archived: body.archived });
      return response(updated);
    }
    return realFetch(input, init);
  };
})();`;

async function waitForValue(client, expression, description, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await client.evaluate(expression)) return;
    await wait(250);
  }
  const diagnostic = await client.evaluate(
    `JSON.stringify({ path: location.pathname, title: document.title, body: document.body?.innerText ?? "", html: document.body?.innerHTML?.slice(0, 1000) ?? "", requests: window.__historyE2E?.requests ?? [] })`,
  );
  const browserErrors = client.events
    .filter((event) => event.method === "Runtime.consoleAPICalled" || event.method === "Runtime.exceptionThrown")
    .slice(-12);
  throw new Error(`Timed out waiting for ${description}: ${diagnostic}; browser=${JSON.stringify(browserErrors)}`);
}

async function clickTestId(client, testId) {
  const clicked = await client.evaluate(
    `(() => { const node = document.querySelector('[data-testid="${testId}"]'); if (!node) return false; node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); node.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Could not click ${testId}`);
}

async function clickText(client, text) {
  const clicked = await client.evaluate(
    `(() => { const wanted = ${JSON.stringify(text)}; const nodes = [...document.querySelectorAll('a,button,[role="button"],*')]; const node = nodes.find((item) => item.textContent?.trim() === wanted); if (!node) return false; node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); node.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Could not click text ${text}`);
}

async function clickVisibleText(client, text) {
  const clicked = await client.evaluate(
    `(() => { const wanted = ${JSON.stringify(text)}; const nodes = [...document.querySelectorAll('a,button,[role="button"],*')]; const node = nodes.find((item) => item.textContent?.trim() === wanted && item.getClientRects().length > 0); if (!node) return false; node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); node.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Could not click visible text ${text}`);
}

async function clickLabel(client, label) {
  const clicked = await client.evaluate(
    `(() => { const node = document.querySelector('[aria-label=${JSON.stringify(label)}]'); if (!node) return false; node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); node.click(); return true; })()`,
  );
  if (!clicked) throw new Error(`Could not click accessibility label ${label}`);
}

async function clickRowAction(client, rowText, actionLabel) {
  const clicked = await client.evaluate(
    `(() => {
      const title = [...document.querySelectorAll("*")].find((item) => item.textContent?.trim() === ${JSON.stringify(rowText)});
      if (!title) return false;
      let current = title;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
        const action = [...(current.querySelectorAll?.("[aria-label]") ?? [])]
          .find((item) => item.getAttribute("aria-label") === ${JSON.stringify(actionLabel)});
        if (action) {
          action.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
          action.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          action.click();
          return true;
        }
      }
      return false;
    })()`,
  );
  if (!clicked) throw new Error(`Could not click ${actionLabel} for ${rowText}`);
}

async function clickVisibleBackControl(client) {
  const result = JSON.parse(
    await client.evaluate(`(() => {
      const controls = [...document.querySelectorAll('button,a,[role="button"]')];
      const named = controls.map((node) => ({
        node,
        name: [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
          .filter(Boolean)
          .join(" ")
          .trim()
          .toLowerCase(),
      }));
      const back = named.find(({ node, name }) =>
        /\\b(back|go back|previous)\\b/.test(name) && node.getClientRects().length > 0
      );
      if (!back) {
        return JSON.stringify({
          clicked: false,
          controls: named.map(({ name }) => name).filter(Boolean),
        });
      }
      back.node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      back.node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      back.node.click();
      return JSON.stringify({ clicked: true });
    })()`),
  );
  if (!result.clicked) {
    throw new Error(`Could not find a visible Environment back control: ${JSON.stringify(result.controls)}`);
  }
}

async function runHubEnvironmentRegression(client, appUrl) {
  await waitForValue(
    client,
    `Boolean(document.querySelector('[data-testid="engram-card-1"]'))`,
    "signed-in engram card",
  );
  await clickVisibleText(client, "Hub");
  await waitForValue(
    client,
    `document.body.innerText.toLowerCase().includes("no hub activity yet.") && ["telemetry", "spaces", "presence", "activity", "simulations", "humanMessages"].every((name) => window.__hubEnvironmentE2E.emptyResponses.includes(name))`,
    "Hub empty activity, spaces, telemetry, and contact fixture",
  );
  const hubText = await client.evaluate("document.body.innerText");
  const normalizedHubText = hubText.toLowerCase();
  for (const expected of [
    "live telemetry",
    "spaces",
    "recent activity",
    "no hub activity yet.",
    "no human contact yet.",
    "no bounded simulation runs yet.",
  ]) {
    if (!normalizedHubText.includes(expected)) {
      throw new Error(`Hub empty state omitted ${JSON.stringify(expected)}: ${hubText}`);
    }
  }

  await clickVisibleText(client, "Personas");
  await waitForValue(
    client,
    `Boolean(document.querySelector('[data-testid="engram-card-1"]'))`,
    "personas tab",
  );
  await clickTestId(client, "engram-card-1");
  await waitForValue(
    client,
    `location.pathname.includes("/engram/1") && document.body.innerText.toLowerCase().includes("no memory entries are available yet.") && document.body.innerText.toLowerCase().includes("no beliefs are registered yet.") && ["memories", "beliefs"].every((name) => window.__hubEnvironmentE2E.emptyResponses.includes(name))`,
    "detail with readable empty Memory and Beliefs",
  );
  await clickVisibleText(client, "Open environment");
  await waitForValue(
    client,
    `location.pathname.includes("/engram/environment") && document.body.innerText.toLowerCase().includes("e2e room")`,
    "Environment opened from detail",
  );
  const environmentText = await client.evaluate("document.body.innerText");
  if (!environmentText.toLowerCase().includes("environment anchor")) {
    throw new Error(`Environment content was not readable: ${environmentText}`);
  }
  await clickVisibleBackControl(client);
  await waitForValue(
    client,
    `location.pathname.includes("/engram/1") && document.body.innerText.toLowerCase().includes("no memory entries are available yet.") && document.body.innerText.toLowerCase().includes("no beliefs are registered yet.")`,
    "return from Environment to the same detail screen",
  );

  await client.call("Page.navigate", { url: `${appUrl}/engram/environment?id=999` });
  await waitForValue(
    client,
    `location.pathname.includes("/engram/environment") && document.body.innerText.toLowerCase().includes("environment unavailable") && document.body.innerText.toLowerCase().includes("could not load this engram's live environment.")`,
    "readable unavailable Environment state",
  );
  const unavailableRequests = await client.evaluate(
    `window.__historyE2E.requests.some(({ path, method }) => path.endsWith("/api/engrams/999") && method === "GET")`,
  );
  if (!unavailableRequests) {
    throw new Error("Unavailable Environment did not use the deterministic missing-engram response");
  }
  console.log(
    "Mobile Hub/Environment browser regression passed: empty Hub sections, empty Memory/Beliefs, detail → Environment → detail, and unavailable Environment.",
  );
}

const processes = [];
let profileDir;
let client;

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([exited, wait(1_500)]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

try {
  const expo = spawn("pnpm", ["exec", "expo", "start", "--web", "--localhost", "--port", String(port)], {
    cwd: mobileRoot,
    env: {
      ...process.env,
      CI: "1",
      EXPO_PUBLIC_E2E_AUTH_BYPASS: "true",
      EXPO_PUBLIC_E2E_NATIVE_EXPORT: nativeExportMode ? "true" : "false",
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.CLERK_PUBLISHABLE_KEY ?? process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  expo.stdout.on("data", (chunk) => process.stdout.write(`[history-e2e expo] ${chunk}`));
  expo.stderr.on("data", (chunk) => process.stderr.write(`[history-e2e expo] ${chunk}`));
  expo.on("exit", (code, signal) => {
    if (code !== 0) {
      process.stderr.write(
        `[history-e2e expo] exited before serving (${code ?? "null"}/${signal ?? "none"})\n`,
      );
    }
  });
  processes.push(expo);
  await waitForHttp(appUrl);

  profileDir = mkdtempSync(path.join(os.tmpdir(), "engram-history-e2e-"));
  const chromeArgs = [
    "--headless",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--no-first-run",
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
  const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
  const chromiumCommand = `exec ${["/repl/tools/bin/chromium", ...chromeArgs]
    .map(shellQuote)
    .join(" ")}`;
  process.stdout.write(`[history-e2e] launching Chromium: ${chromiumCommand}\n`);
  const chromium = spawn(
    "/bin/sh",
    ["-c", chromiumCommand],
    { stdio: ["ignore", "ignore", "pipe"], detached: true },
  );
  chromium.stderr.on("data", (chunk) => process.stderr.write(`[history-e2e chromium] ${chunk}`));
  chromium.on("exit", (code, signal) => {
    if (code !== 0) {
      process.stderr.write(
        `[history-e2e chromium] exited before CDP became ready (${code ?? "null"}/${signal ?? "none"})\n`,
      );
    }
  });
  processes.push(chromium);
  await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
  const targets = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const target = targets.find((item) => item.type === "page");
  if (!target?.webSocketDebuggerUrl) throw new Error("Chromium did not expose a page target");
  client = cdpClient(target.webSocketDebuggerUrl);
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Page.addScriptToEvaluateOnNewDocument", { source: browserMock });
  await client.call("Page.navigate", { url: `${appUrl}/` });

  if (scenario === "hub-environment") {
    await runHubEnvironmentRegression(client, appUrl);
  } else {
  await waitForValue(client, `Boolean(document.querySelector('[data-testid="engram-card-1"]'))`, "signed-in engram card");
  await clickTestId(client, "engram-card-1");
  await waitForValue(client, `location.pathname.includes("/engram/1")`, "engram detail route");
  await client.evaluate("history.back()");
  await waitForValue(client, `document.body.innerText.includes("Chat")`, "chat tab");
  await clickText(client, "Chat");
  await waitForValue(client, `Boolean(document.querySelector('[aria-label="History"]'))`, "chat screen");

  await clickLabel(client, "History");
  await waitForValue(client, `document.body.innerText.includes("Hydrated history")`, "second active conversation");
  await clickText(client, "Hydrated history");
  await waitForValue(client, `document.body.innerText.includes("Hydrated history message")`, "selected conversation hydration");

  await clickLabel(client, "History");
  await clickRowAction(client, "Hydrated history", "Archive conversation");
  await waitForValue(client, `window.__historyE2E.archiveRequests.some((item) => item.id === 102 && item.archived === true)`, "archive request");
  await clickText(client, "Archived");
  await waitForValue(client, `document.body.innerText.includes("Hydrated history")`, "archived conversation");
  await waitForValue(
    client,
    `(() => { const input = document.querySelector("textarea, input"); const send = document.querySelector('[data-testid="send-button"]'); return input?.readOnly === true || send?.getAttribute("aria-disabled") === "true" || send?.hasAttribute("disabled"); })()`,
    "archived conversation read-only controls",
  );
  await clickLabel(client, "Restore conversation");
  await waitForValue(client, `window.__historyE2E.archiveRequests.some((item) => item.id === 102 && item.archived === false)`, "restore request");
  await waitForValue(client, `document.body.innerText.includes("Hydrated history message")`, "restored conversation");
  await clickLabel(client, "Export conversation");
  if (nativeExportMode) {
    const retryMessage = "Export could not be created. Tap a format to try again.";
    await clickText(client, "Markdown");
    await waitForValue(
      client,
      `document.body.innerText.includes(${JSON.stringify(retryMessage)}) && Boolean(document.querySelector('[aria-label="Dismiss export error"]'))`,
      "native export retry guidance",
    );
    await waitForValue(
      client,
      `Boolean(document.querySelector('[aria-label="Close export options"]'))`,
      "export sheet remains open after failure",
    );
    await clickLabel(client, "Dismiss export error");
    await waitForValue(
      client,
      `!document.body.innerText.includes(${JSON.stringify(retryMessage)}) && Boolean(document.querySelector('[aria-label="Close export options"]'))`,
      "dismissed export retry guidance",
    );
    await clickText(client, "Markdown");
    await waitForValue(
      client,
      `window.__historyE2E.nativeExport.attempts === 2 && window.__historyE2E.nativeExport.shares.length === 1 && !document.querySelector('[aria-label="Close export options"]')`,
      "successful native export retry closes the sheet",
    );
    const nativeResult = await client.evaluate(`JSON.stringify(window.__historyE2E.nativeExport)`);
    const nativeParsed = JSON.parse(nativeResult);
    if (
      nativeParsed.attempts !== 2 ||
      nativeParsed.shares.length !== 1 ||
      nativeParsed.deleted.length !== 2
    ) {
      throw new Error(`Unexpected native export lifecycle: ${nativeResult}`);
    }
    console.log("Mobile native export browser regression passed: failure guidance, dismissal, retry, and successful close.");
  } else {
    for (const label of ["Markdown", "Plain text", "PDF", "Word document"]) {
      await clickText(client, label);
      await waitForValue(client, `window.__historyE2E.downloads.length >= ${label === "Markdown" ? 1 : label === "Plain text" ? 2 : label === "PDF" ? 3 : 4}`, `${label} download`);
      await clickLabel(client, "Export conversation");
    }
    const result = await client.evaluate(`JSON.stringify({
      archiveRequests: window.__historyE2E.archiveRequests,
      downloads: window.__historyE2E.downloads
    })`);
    const parsed = JSON.parse(result);
    const expectedDownloads = [
      ["Hydrated-history.md", "text/markdown", []],
      ["Hydrated-history.txt", "text/plain", []],
      ["Hydrated-history.pdf", "application/pdf", [37, 80, 68, 70], true, true, true, true],
      [
        "Hydrated-history.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        [80, 75, 3, 4],
        false,
      ],
    ];
    if (
      parsed.downloads.length !== expectedDownloads.length ||
      parsed.downloads.some(
        (download, index) =>
          download.filename !== expectedDownloads[index][0] ||
          download.type !== expectedDownloads[index][1] ||
          download.size <= 0 ||
          Boolean(download.hasJpegImage) !== Boolean(expectedDownloads[index][3]) ||
          Boolean(download.hasToUnicodeMap) !== Boolean(expectedDownloads[index][4]) ||
          Boolean(download.hasInvisibleTextLayer) !== Boolean(expectedDownloads[index][5]) ||
          Boolean(download.hasCjkMapping) !== Boolean(expectedDownloads[index][6]) ||
          expectedDownloads[index][2].some(
            (byte, byteIndex) => download.prefix[byteIndex] !== byte,
          ),
      )
    ) {
      throw new Error(`Unexpected export payloads: ${result}`);
    }
    const pdfDownload = parsed.downloads.find((download) => download.filename.endsWith(".pdf"));
    const pdfProbePath = path.join(os.tmpdir(), `engram-history-e2e-${process.pid}.pdf`);
    if (!pdfDownload?.pdfBase64) {
      throw new Error("PDF download did not include a probe payload");
    }
    writeFileSync(pdfProbePath, Buffer.from(pdfDownload.pdfBase64, "base64"));
    try {
      const extractedText = execFileSync("pdftotext", [pdfProbePath, "-"], {
        encoding: "utf8",
      });
      for (const expectedText of ["Café", "你好", "Привет", "नमस्ते", "Γειά"]) {
        if (!extractedText.includes(expectedText)) {
          throw new Error(`PDF text extraction omitted ${expectedText}: ${JSON.stringify(extractedText)}`);
        }
      }
      for (const expectedCharacter of Array.from("مرحباשלום")) {
        if (!extractedText.includes(expectedCharacter)) {
          throw new Error(`PDF text extraction omitted ${expectedCharacter}: ${JSON.stringify(extractedText)}`);
        }
      }
    } finally {
      rmSync(pdfProbePath, { force: true });
    }
    console.log("Mobile history browser regression passed: hydrate, archive, restore, read-only state, and four export downloads.");
  }
  }
} finally {
  client?.close();
  for (const child of processes.reverse()) await stopProcess(child);
  if (profileDir) {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  }
}