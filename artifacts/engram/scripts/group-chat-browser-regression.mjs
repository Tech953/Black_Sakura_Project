import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9231);
const profileDir = await mkdtemp(join(tmpdir(), "engram-group-chat-profile-"));

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
}

const devtools = new DevTools();

const fixtureScript = String.raw`
(() => {
  const originalFetch = window.fetch.bind(window);
  const storageKey = "__engram_group_chat_fixture__";
  const stored = JSON.parse(window.localStorage.getItem(storageKey) || "null");
  const state = stored && typeof stored === "object"
    ? stored
    : { showInList: false, conversation: null, messages: [], createBody: null, exchangeCount: 0 };
  if (!Number.isInteger(state.exchangeCount)) state.exchangeCount = 0;
  const requests = [];
  const fixtureInstanceId = crypto.randomUUID();
  const engrams = [
    {
      id: 1,
      name: "Mira",
      title: "Signal Cartographer",
      symbol: "◇",
      isArchival: false,
      isChatActive: true,
      continuationEligibility: { eligible: true },
    },
    {
      id: 2,
      name: "Aster",
      title: "Night Analyst",
      symbol: "△",
      isArchival: false,
      isChatActive: true,
      continuationEligibility: { eligible: true },
    },
    {
      id: 3,
      name: "Sol",
      title: "Quiet Observer",
      symbol: "○",
      isArchival: false,
      isChatActive: true,
      continuationEligibility: {
        eligible: false,
        reason: "autonomy is disabled for this engram",
      },
    },
  ];
  const makeHubMessage = (id, spaceId, content) => {
    const createdAt = new Date(Date.UTC(2026, 8, 15, 12, 0, id)).toISOString();
    return {
      id,
      fromEngramId: 1,
      toEngramId: 2,
      spaceId,
      channel: "commons",
      author: "engram",
      priority: "normal",
      status: "delivered",
      content,
      reason: null,
      seen: true,
      isDigest: false,
      digestGroupId: null,
      deliveredAt: createdAt,
      createdAt,
    };
  };
  const hubTranscripts = new Map([
    [101, Array.from({ length: 20 }, (_, index) => makeHubMessage(
      index + 1,
      101,
      "Alpha turn " + String(index + 1).padStart(2, "0") + " — " + "A".repeat(180),
    ))],
    [202, [makeHubMessage(2021, 202, "Beta space transcript only")]],
  ]);
  const hubSpaces = [
    {
      id: 101,
      slug: "commons-alpha",
      name: "Commons Alpha",
      kind: "commons",
      description: "First Commons space",
      visibilityScope: "public",
      actionScope: "converse",
      logged: true,
      allowsInitiative: true,
      sortOrder: 1,
      ambient: null,
      accent: null,
      createdAt: "2026-09-15T12:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    },
    {
      id: 202,
      slug: "commons-beta",
      name: "Commons Beta",
      kind: "commons",
      description: "Second Commons space",
      visibilityScope: "public",
      actionScope: "converse",
      logged: true,
      allowsInitiative: true,
      sortOrder: 2,
      ambient: null,
      accent: null,
      createdAt: "2026-09-15T12:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    },
  ];
  const hubActivity = [
    {
      id: 1,
      spaceId: 101,
      engramId: 1,
      kind: "converse",
      summary: "Mira and Aster spoke in Commons Alpha",
      createdAt: "2026-09-15T12:02:00.000Z",
    },
    {
      id: 2,
      spaceId: 202,
      engramId: 2,
      kind: "converse",
      summary: "Mira and Aster spoke in Commons Beta",
      createdAt: "2026-09-15T12:01:00.000Z",
    },
  ];
  let hubPresence = [
    {
      id: 1,
      engramId: 1,
      spaceId: 101,
      status: "active",
      note: null,
      enteredAt: "2026-09-15T12:00:00.000Z",
      updatedAt: "2026-09-15T12:00:00.000Z",
    },
  ];
  const hubMoveRequests = [];
  const hubTranscriptScenarioKey = "__hub_transcript_browser_scenario__";
  const hubTranscriptScenario =
    window.localStorage.getItem(hubTranscriptScenarioKey) ?? "hold-first";
  let releaseHeldTranscriptResponse = null;
  const persist = () => window.localStorage.setItem(storageKey, JSON.stringify(state));
  window.__groupChatFixture = {
    get instanceId() { return fixtureInstanceId; },
    requests,
    get createBody() { return state.createBody; },
    get conversation() { return state.conversation; },
    get messageCount() { return state.messages.length; },
    get transcript() {
      return state.messages.map((message) => ({
        role: message.role,
        content: message.content,
        speakerEngramId: message.speakerEngramId,
        autonomous: message.autonomous,
      }));
    },
    get autonomousCount() {
      return state.messages.filter((message) => message.autonomous === true).length;
    },
    showConversationInList() {
      state.showInList = true;
      persist();
    },
    makeContinuationStale() {
      state.conversation.groupContinuationRevision =
        (state.conversation.groupContinuationRevision ?? 0) + 1;
      persist();
    },
    resetConversation() {
      state.showInList = false;
      state.conversation = null;
      state.messages = [];
      state.createBody = null;
      state.exchangeCount = 0;
      persist();
    },
  };
  window.__hubTranscriptFixture = {
    requests,
    get transcriptSpaceIds() {
      return requests.flatMap(({ pathname }) => {
        const match = pathname.match(/^\/api\/hub\/spaces\/(\d+)\/transcript$/);
        return match ? [Number(match[1])] : [];
      });
    },
    readCount(spaceId) {
      const path = "/api/hub/spaces/" + spaceId + "/transcript";
      return requests.filter((request) => request.pathname === path && request.method === "GET").length;
    },
    setScenario(scenario) {
      window.localStorage.setItem(hubTranscriptScenarioKey, scenario);
    },
    releaseHeldTranscript() {
      const release = releaseHeldTranscriptResponse;
      releaseHeldTranscriptResponse = null;
      if (!release) return false;
      release(response(hubTranscripts.get(101).slice(-20).reverse()));
      return true;
    },
    addTurn(spaceId, content) {
      const transcript = hubTranscripts.get(spaceId);
      if (!transcript) throw new Error("Unknown test Commons space");
      const id = Math.max(0, ...transcript.map((message) => message.id)) + 1;
      transcript.push(makeHubMessage(id, spaceId, content));
      return id;
    },
  };
  window.__hubMoveFixture = {
    moveRequests: hubMoveRequests,
    get presence() {
      return hubPresence;
    },
  };
  const response = (body, status = 200, headers = { "Content-Type": "application/json" }) =>
    new Response(JSON.stringify(body), { status, headers });
  const currentConversation = () => ({
    ...state.conversation,
    engramIds: [1, 2],
    groupContinuationMode: state.conversation?.groupContinuationMode ?? "short",
    groupContinuationRevision: state.conversation?.groupContinuationRevision ?? 0,
  });
  const groupStream = (initialReplies, continuationReplies, signal, continuationDelay) =>
    new Response(new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let closed = false;
        let timer;
        const closeWithAbort = () => {
          if (closed) return;
          closed = true;
          if (timer) clearTimeout(timer);
          try {
            controller.error(new DOMException("The operation was aborted.", "AbortError"));
          } catch {}
        };
        const emit = (reply) => {
          if (closed) return;
          state.messages.push({
            id: state.messages.length + 1,
            role: "assistant",
            ...reply,
            createdAt: "2026-09-12T12:01:01.000Z",
          });
          persist();
          controller.enqueue(encoder.encode("data: " + JSON.stringify(reply) + "\n\n"));
        };
        for (const reply of initialReplies) emit(reply);
        let continuationIndex = 0;
        const emitContinuation = () => {
          if (closed) return;
          const reply = continuationReplies[continuationIndex++];
          if (reply) {
            emit(reply);
            timer = setTimeout(emitContinuation, continuationDelay);
            return;
          }
          controller.enqueue(encoder.encode("data: " + JSON.stringify({ done: true }) + "\n\n"));
          closed = true;
          controller.close();
        };
        timer = setTimeout(emitContinuation, continuationDelay);
        if (signal) {
          signal.addEventListener("abort", closeWithAbort, { once: true });
          if (signal.aborted) closeWithAbort();
        }
      },
    }), {
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
    });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET"),
    ).toUpperCase();
    const pathname = new URL(url, window.location.origin).pathname;
    requests.push({ pathname, method });

    if (pathname === "/api/hub/spaces" && method === "GET") return response(hubSpaces);
    if (pathname === "/api/hub/presence" && method === "GET") return response(hubPresence);
    const moveMatch = pathname.match(/^\/api\/hub\/presence\/(\d+)$/);
    if (moveMatch && method === "PUT") {
      const moveRequest = {
        engramId: Number(moveMatch[1]),
        data: JSON.parse(init.body || "{}"),
      };
      hubMoveRequests.push(moveRequest);
      if (hubMoveRequests.length === 1) {
        return response({ error: "The server blocked this move." }, 500);
      }
      if (hubMoveRequests.length === 2) {
        return response({ error: "   " }, 500);
      }
      const previous = hubPresence.find((entry) => entry.engramId === moveRequest.engramId);
      const updated = {
        id: previous?.id ?? 99,
        engramId: moveRequest.engramId,
        spaceId: moveRequest.data.spaceId,
        status: "active",
        note: moveRequest.data.note ?? null,
        enteredAt:
          previous?.spaceId === moveRequest.data.spaceId
            ? previous.enteredAt
            : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      hubPresence = hubPresence
        .filter((entry) => entry.engramId !== moveRequest.engramId)
        .concat(updated);
      return response(updated);
    }
    if (pathname === "/api/hub/activity" && method === "GET") return response(hubActivity);
    const transcriptMatch = pathname.match(/^\/api\/hub\/spaces\/(\d+)\/transcript$/);
    if (transcriptMatch && method === "GET") {
      const spaceId = Number(transcriptMatch[1]);
      const transcript = hubTranscripts.get(spaceId) ?? [];
      const readCount = requests.filter(
        (request) => request.pathname === pathname && request.method === "GET",
      ).length;
      if (
        spaceId === 101 &&
        hubTranscriptScenario === "hold-first" &&
        readCount === 1
      ) {
        return new Promise((resolve) => {
          releaseHeldTranscriptResponse = resolve;
        });
      }
      if (spaceId === 101 && hubTranscriptScenario === "empty") {
        return response([]);
      }
      if (spaceId === 101 && hubTranscriptScenario === "foreign") {
        return response({ error: "Space not found" }, 404);
      }
      return response(transcript.slice(-20).reverse());
    }

    if (pathname === "/api/engrams" && method === "GET") return response(engrams);
    if (pathname === "/api/events") return response({});
    if (pathname === "/api/openai/conversations" && method === "GET") {
      return response(state.showInList && state.conversation ? [currentConversation()] : []);
    }
    if (pathname === "/api/openai/conversations" && method === "POST") {
      const body = JSON.parse(init.body || "{}");
      state.createBody = body;
      state.conversation = {
        id: 77,
        title: body.title,
        mode: "companion",
        personaName: null,
        customEngram: null,
        engramId: null,
        engramIds: [1, 2],
        groupContinuationMode: body.groupContinuationMode || "short",
        groupContinuationRevision: 0,
        createdAt: "2026-09-12T12:00:00.000Z",
        archivedAt: null,
      };
      state.messages = [];
      persist();
      return response(currentConversation(), 201);
    }
    if (pathname === "/api/openai/conversations/77" && method === "GET") {
      return response({ ...currentConversation(), messages: state.messages });
    }
    if (pathname === "/api/openai/conversations/77/continuation" && method === "PATCH") {
      const body = JSON.parse(init.body || "{}");
      if (body.expectedRevision !== (state.conversation?.groupContinuationRevision ?? 0)) {
        return response({
          error: "The group continuation setting changed elsewhere.",
          code: "GROUP_CONTINUATION_CONFLICT",
          groupContinuationMode: state.conversation?.groupContinuationMode ?? "short",
          groupContinuationRevision: state.conversation?.groupContinuationRevision ?? 0,
        }, 409);
      }
      state.conversation.groupContinuationMode = body.groupContinuationMode;
      state.conversation.groupContinuationRevision =
        (state.conversation.groupContinuationRevision ?? 0) + 1;
      persist();
      return response(currentConversation());
    }
    if (pathname === "/api/openai/conversations/77/messages" && method === "POST") {
      const body = JSON.parse(init.body || "{}");
      const content = body.content;
      state.messages.push({
        id: state.messages.length + 1,
        role: "user",
        content,
        createdAt: "2026-09-12T12:01:00.000Z",
      });
      const exchange = state.exchangeCount++;
      const mode = state.conversation?.groupContinuationMode ?? "short";
      const initialReplies = exchange === 0
        ? [
            {
              speakerEngramId: 1,
              content: mode === "short" ? "Mira initial group reply" : "Mira " + mode + " initial group reply",
            },
            {
              speakerEngramId: 2,
              content: mode === "short" ? "Aster initial group reply" : "Aster " + mode + " initial group reply",
            },
          ]
        : [
            { speakerEngramId: 1, content: "Mira stopped exchange reply" },
            { speakerEngramId: 2, content: "Aster stopped exchange reply" },
          ];
      const continuationReplies = exchange > 0
        ? [{ speakerEngramId: 1, content: "Mira stopped autonomous reply", autonomous: true }]
        : mode === "off"
          ? []
          : Array.from({ length: mode === "extended" ? 4 : 2 }, (_, index) => ({
              speakerEngramId: index % 2 === 0 ? 1 : 2,
              content: mode === "short" && index === 0
                ? "Mira autonomous peer reply"
                : (index % 2 === 0 ? "Mira" : "Aster") + " " + mode + " peer continuation " + (index + 1),
              autonomous: true,
            }));
      persist();
      return groupStream(
        initialReplies,
        continuationReplies,
        init.signal,
        exchange === 0 ? 300 : 1200,
      );
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
  const diagnostics = await devtools.evaluate(`({
    body: document.body?.innerText,
    requests: window.__groupChatFixture?.requests,
    root: document.querySelector("#root")?.innerHTML?.slice(0, 500)
  })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostics)}`);
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
  if (!clicked) {
    const diagnostics = await devtools.evaluate(`({
      dialogs: Array.from(document.querySelectorAll('[role="dialog"]')).map((dialog) => dialog.innerText),
      buttons: Array.from(document.querySelectorAll('[role="dialog"] button')).map((button) => ({
        text: button.textContent,
        aria: button.getAttribute("aria-label"),
        pressed: button.getAttribute("aria-pressed")
      }))
    })`);
    throw new Error(`Could not click ${label}: ${JSON.stringify(diagnostics)}`);
  }
}

async function fill(expression, value, label) {
  const filled = await devtools.evaluate(`(() => {
    const node = ${expression};
    if (!node) return false;
    const prototype = node instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(node, ${JSON.stringify(value)});
    else node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error(`Could not fill ${label}`);
}

async function labeledMessageVisible(label, content) {
  return devtools.evaluate(`(() => Array.from(document.querySelectorAll("div")).some((node) => {
    if (node.textContent?.trim() !== ${JSON.stringify(label)}) return false;
    return node.parentElement?.textContent?.includes(${JSON.stringify(content)}) === true;
  }))()`);
}

async function hubActivitySnapshot() {
  return devtools.evaluate(`Array.from(
    document.querySelectorAll('[data-testid^="activity-"]'),
  ).map((row) => ({
    id: row.getAttribute("data-testid"),
    text: row.innerText,
  }))`);
}

async function reloadFixtureDocument(label) {
  const previousInstance = await devtools.evaluate("window.__groupChatFixture.instanceId");
  await devtools.call("Page.reload");
  await waitFor(
    `window.__groupChatFixture?.instanceId && window.__groupChatFixture.instanceId !== ${JSON.stringify(previousInstance)}`,
    label,
  );
}

async function resetFixtureConversation() {
  await devtools.evaluate("window.__groupChatFixture.resetConversation()");
  await reloadFixtureDocument("reset group chat document");
  await waitFor(`Boolean(document.body?.innerText.includes("CONVERSATIONS"))`, "chat page after reset");
}

async function startGroupConversation(title, mode) {
  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-plus"))`,
    `new ${mode} conversation`,
  );
  await waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, `${mode} conversation dialog`);
  await waitFor(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).some((node) => node.textContent?.includes("Mira"))`,
    `${mode} Mira participant option`,
  );
  await waitFor(
    `document.body?.innerText.includes("Peer continuation blocked") && document.body?.innerText.includes("Autonomy is disabled")`,
    `${mode} blocked continuation explanation`,
  );
  await fill(`document.querySelector('[role="dialog"] input')`, title, `${mode} conversation title`);
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.includes("Mira"))`,
    `${mode} Mira participant`,
  );
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.includes("Aster"))`,
    `${mode} Aster participant`,
  );
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.trim().toLowerCase().startsWith(${JSON.stringify(mode)}))`,
    `${mode} continuation choice`,
  );
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.toLowerCase().includes("start conversation"))`,
    `start ${mode} group conversation`,
  );
  await waitFor(
    `Boolean(document.querySelector("textarea") && !document.querySelector("textarea").disabled)`,
    `${mode} group composer`,
  );
  const createBody = await devtools.evaluate("window.__groupChatFixture.createBody");
  if (
    JSON.stringify(createBody?.engramIds) !== JSON.stringify([1, 2]) ||
    createBody?.groupContinuationMode !== mode
  ) {
    throw new Error(`${mode} group creation submitted the wrong consent: ${JSON.stringify(createBody)}`);
  }
}

async function reloadConversation(title, content, label) {
  await devtools.evaluate("window.__groupChatFixture.showConversationInList()");
  await reloadFixtureDocument(`reloaded ${label} chat document`);
  await waitFor(
    `Boolean(Array.from(document.querySelectorAll("button")).some((node) => node.textContent?.toLowerCase().includes(${JSON.stringify(title.toLowerCase())})))`,
    `${label} conversation button after reload`,
  );
  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.textContent?.toLowerCase().includes(${JSON.stringify(title.toLowerCase())}))`,
    `reloaded ${label} group conversation`,
  );
  await waitFor(`Boolean(document.body?.innerText.includes(${JSON.stringify(content)}))`, `reloaded ${label} transcript`);
}

async function openGroupSettings(label) {
  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.getAttribute("aria-label")?.toLowerCase().includes("group continuation") || node.querySelector("svg")?.className?.baseVal?.includes("settings-2"))`,
    `${label} group settings`,
  );
  await waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, `${label} group settings dialog`);
}

async function saveGroupConsent(mode, label, { forceConflict = false } = {}) {
  await openGroupSettings(label);
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.trim().toLowerCase().startsWith(${JSON.stringify(mode)}))`,
    `${label} ${mode} consent choice`,
  );
  if (forceConflict) {
    await devtools.evaluate("window.__groupChatFixture.makeContinuationStale()");
  }
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.trim().toLowerCase() === "save")`,
    `${label} save consent`,
  );
  if (forceConflict) {
    await waitFor(
      `Boolean(document.querySelector('[role="dialog"]')) && document.body?.innerText.includes("This setting changed elsewhere")`,
      `${label} stale consent conflict`,
    );
    const selectedMode = await devtools.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const selected = Array.from(dialog?.querySelectorAll("button") ?? [])
        .find((node) => node.className.includes("border-primary/50"));
      return selected?.textContent?.trim().toLowerCase() ?? null;
    })()`);
    const currentMode = await devtools.evaluate(
      "window.__groupChatFixture.conversation?.groupContinuationMode",
    );
    if (!selectedMode?.startsWith(currentMode)) {
      throw new Error(`${label} conflict selected ${selectedMode}, expected refreshed ${currentMode}`);
    }
    await click(
      `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.trim().toLowerCase() === "cancel")`,
      `${label} close stale consent dialog`,
    );
    await waitFor(`!document.querySelector('[role="dialog"]')`, `${label} stale consent dialog close`);
    return;
  }
  await waitFor(`!document.querySelector('[role="dialog"]')`, `${label} consent dialog close`);
  await waitFor(
    `window.__groupChatFixture.conversation?.groupContinuationMode === ${JSON.stringify(mode)}`,
    `${label} persisted ${mode} consent`,
  );
}

async function assertGroupConsentAfterReload(mode, baseline, label) {
  const snapshot = await devtools.evaluate("({ participants: window.__groupChatFixture.conversation?.engramIds, transcript: window.__groupChatFixture.transcript })");
  if (
    JSON.stringify(snapshot.participants) !== JSON.stringify(baseline.participants) ||
    JSON.stringify(snapshot.transcript) !== JSON.stringify(baseline.transcript)
  ) {
    throw new Error(`${label} consent changed group participants or prior messages: ${JSON.stringify(snapshot)}`);
  }

  await openGroupSettings(label);
  const selectedMode = await devtools.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const selected = Array.from(dialog?.querySelectorAll("button") ?? [])
      .find((node) => node.className.includes("border-primary/50"));
    return selected?.textContent?.trim().toLowerCase() ?? null;
  })()`);
  if (!selectedMode?.startsWith(mode)) {
    throw new Error(`${label} reload selected ${selectedMode}, expected ${mode}`);
  }
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.trim().toLowerCase() === "cancel")`,
    `${label} close consent dialog`,
  );
  await waitFor(`!document.querySelector('[role="dialog"]')`, `${label} consent dialog close after reload`);
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: fixtureScript,
  });
  await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  await waitFor(`Boolean(document.body?.innerText.includes("CONVERSATIONS"))`, "chat page");

  await startGroupConversation("First Message Group", "short");

  await fill(`document.querySelector("textarea")`, "Begin the first group exchange.", "first group message");
  await click(`Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-send"))`, "send first group message");
  await waitFor(`Boolean(document.body?.innerText.includes("Mira initial group reply"))`, "Mira initial reply");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster initial group reply"))`, "Aster initial reply");
  await waitFor(`Boolean(document.body?.innerText.includes("Mira autonomous peer reply"))`, "autonomous peer reply");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster short peer continuation 2"))`, "short continuation limit");
  const shortCounts = await devtools.evaluate("({ messages: window.__groupChatFixture.messageCount, autonomous: window.__groupChatFixture.autonomousCount })");
  if (shortCounts.messages !== 5 || shortCounts.autonomous !== 2) {
    throw new Error(`Short continuation exceeded its documented limit: ${JSON.stringify(shortCounts)}`);
  }

  for (const [label, content] of [
    ["MIRA · ◇", "Mira initial group reply"],
    ["ASTER · △", "Aster initial group reply"],
    ["MIRA · ◇", "Mira autonomous peer reply"],
    ["ASTER · △", "Aster short peer continuation 2"],
  ]) {
    if (!(await labeledMessageVisible(label, content))) {
      throw new Error(`Reply was not labeled with ${label}: ${content}`);
    }
  }

  await reloadConversation("First Message Group", "Aster short peer continuation 2", "short");
  const reloadedText = await devtools.evaluate("document.body.innerText");
  for (const text of ["MIRA · ◇", "ASTER · △", "Mira initial group reply", "Aster initial group reply"]) {
    if (!reloadedText.includes(text)) throw new Error(`Reloaded transcript is missing ${text}`);
  }

  await fill(`document.querySelector("textarea")`, "Stop the next group exchange.", "stoppable group message");
  await click(`Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-send"))`, "send stoppable group message");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster stopped exchange reply"))`, "stoppable initial peer replies");
  const beforeStopCount = await devtools.evaluate("window.__groupChatFixture.messageCount");
  if (beforeStopCount !== 8) {
    throw new Error(`Unexpected persisted count before stop: ${beforeStopCount}`);
  }
  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.getAttribute("aria-label")?.toLowerCase().includes("stop"))`,
    "stop group continuation",
  );
  await waitFor(`Boolean(document.querySelector("textarea") && !document.querySelector("textarea").disabled)`, "stopped group composer");
  await delay(1500);
  const afterStop = await devtools.evaluate("({ count: window.__groupChatFixture.messageCount, body: document.body.innerText })");
  if (afterStop.count !== 8 || afterStop.body.includes("Mira stopped autonomous reply")) {
    throw new Error(`Stopping the group exchange allowed a later peer reply: ${JSON.stringify(afterStop)}`);
  }

  await reloadConversation("First Message Group", "Aster stopped exchange reply", "stopped");
  const stoppedReload = await devtools.evaluate("({ count: window.__groupChatFixture.messageCount, body: document.body.innerText })");
  if (stoppedReload.count !== 8 || stoppedReload.body.includes("Mira stopped autonomous reply")) {
    throw new Error(`Stopped transcript changed after reload: ${JSON.stringify(stoppedReload)}`);
  }

  const consentBaseline = await devtools.evaluate("({ participants: window.__groupChatFixture.conversation?.engramIds, transcript: window.__groupChatFixture.transcript })");
  if (
    JSON.stringify(consentBaseline.participants) !== JSON.stringify([1, 2]) ||
    consentBaseline.transcript.length !== 8
  ) {
    throw new Error(`Existing group fixture was not ready for consent persistence checks: ${JSON.stringify(consentBaseline)}`);
  }
  for (const mode of ["off", "short", "extended"]) {
    await saveGroupConsent(mode, `existing group ${mode}`, { forceConflict: mode === "short" });
    if (mode === "short") {
      await saveGroupConsent(mode, `existing group ${mode} retry`);
    }
    await reloadConversation("First Message Group", "Aster stopped exchange reply", `existing group ${mode}`);
    await assertGroupConsentAfterReload(mode, consentBaseline, `existing group ${mode}`);
  }

  await resetFixtureConversation();
  await startGroupConversation("Off Group", "off");
  await fill(`document.querySelector("textarea")`, "Use the off continuation choice.", "off group message");
  await click(`Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-send"))`, "send off group message");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster off initial group reply"))`, "off initial replies");
  await waitFor(`window.__groupChatFixture.messageCount === 3`, "off persisted transcript");
  const offCounts = await devtools.evaluate("({ messages: window.__groupChatFixture.messageCount, autonomous: window.__groupChatFixture.autonomousCount, body: document.body.innerText })");
  if (
    offCounts.messages !== 3 ||
    offCounts.autonomous !== 0 ||
    offCounts.body.includes("Mira off peer continuation") ||
    offCounts.body.includes("Aster off peer continuation")
  ) {
    throw new Error(`Off continuation produced an unexpected peer continuation: ${JSON.stringify(offCounts)}`);
  }
  await reloadConversation("Off Group", "Aster off initial group reply", "off");
  const offReload = await devtools.evaluate("({ messages: window.__groupChatFixture.messageCount, autonomous: window.__groupChatFixture.autonomousCount, body: document.body.innerText })");
  if (
    offReload.messages !== 3 ||
    offReload.autonomous !== 0 ||
    offReload.body.includes("Mira off peer continuation") ||
    offReload.body.includes("Aster off peer continuation")
  ) {
    throw new Error(`Off transcript changed after reload: ${JSON.stringify(offReload)}`);
  }

  await resetFixtureConversation();
  await startGroupConversation("Extended Group", "extended");
  await fill(`document.querySelector("textarea")`, "Use the extended continuation choice.", "extended group message");
  await click(`Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-send"))`, "send extended group message");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster extended peer continuation 4"))`, "extended continuation limit");
  await waitFor(`window.__groupChatFixture.messageCount === 7`, "extended persisted transcript");
  const extendedCounts = await devtools.evaluate("({ messages: window.__groupChatFixture.messageCount, autonomous: window.__groupChatFixture.autonomousCount, body: document.body.innerText })");
  if (
    extendedCounts.messages !== 7 ||
    extendedCounts.autonomous !== 4 ||
    extendedCounts.body.includes("continuation 5")
  ) {
    throw new Error(`Extended continuation exceeded its documented limit: ${JSON.stringify(extendedCounts)}`);
  }
  await reloadConversation("Extended Group", "Aster extended peer continuation 4", "extended");
  const extendedReload = await devtools.evaluate("({ messages: window.__groupChatFixture.messageCount, autonomous: window.__groupChatFixture.autonomousCount, body: document.body.innerText })");
  if (
    extendedReload.messages !== 7 ||
    extendedReload.autonomous !== 4 ||
    extendedReload.body.includes("continuation 5")
  ) {
    throw new Error(`Extended transcript changed after reload: ${JSON.stringify(extendedReload)}`);
  }

  await devtools.call("Page.navigate", { url: `${appUrl}/hub` });
  await waitFor(
    `Boolean(document.querySelector('[data-testid="button-open-transcript-1"]'))`,
    "Hub Commons activity feed",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="card-space-commons-alpha"] [data-testid="occupant-1"]'))`,
    "Mira's last confirmed location",
  );
  await click(
    `document.querySelector('[data-testid="button-relocate"]')`,
    "open Hub move dialog",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="select-move-engram"]'))`,
    "Hub move dialog",
  );
  await click(
    `document.querySelector('[data-testid="select-move-engram"]')`,
    "open engram selector",
  );
  await waitFor(
    `Array.from(document.querySelectorAll('[role="option"]')).some((option) => option.textContent?.includes("Mira"))`,
    "Mira move option",
  );
  await click(
    `Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent?.includes("Mira"))`,
    "select Mira",
  );
  await click(
    `document.querySelector('[data-testid="select-move-space"]')`,
    "open destination selector",
  );
  await waitFor(
    `Array.from(document.querySelectorAll('[role="option"]')).some((option) => option.textContent?.includes("Commons Beta"))`,
    "Commons Beta destination",
  );
  await click(
    `Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent?.includes("Commons Beta"))`,
    "select Commons Beta",
  );
  await fill(
    `document.querySelector('[data-testid="input-move-note"]')`,
    "browser retry note",
    "Hub move note",
  );
  const hubQueriesBeforeMove = await devtools.evaluate(`({
    presenceReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/presence" && method === "GET",
    ).length,
    activityReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/activity" && method === "GET",
    ).length,
    activityRows: Array.from(document.querySelectorAll('[data-testid^="activity-"]'))
      .map((row) => row.textContent?.trim() ?? "")
  })`);
  await click(
    `document.querySelector('[data-testid="button-confirm-move"]')`,
    "submit Hub move",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="hub-move-error"]')) &&
      window.__hubMoveFixture.moveRequests.length === 1 &&
      Array.from(document.querySelectorAll('[data-state="open"].destructive'))
        .some((toast) => toast.innerText.includes("The server blocked this move."))`,
    "retryable Hub move failure toast",
  );
  const failedMoveState = await devtools.evaluate(`({
    error: document.querySelector('[data-testid="hub-move-error"]')?.innerText,
    toastText: Array.from(document.querySelectorAll('[data-state="open"].destructive'))
      .map((toast) => toast.innerText)
      .join(" "),
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    alphaHasMira: Boolean(document.querySelector('[data-testid="card-space-commons-alpha"] [data-testid="occupant-1"]')),
    betaHasMira: Boolean(document.querySelector('[data-testid="card-space-commons-beta"] [data-testid="occupant-1"]')),
    presence: window.__hubMoveFixture.presence,
    presenceReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/presence" && method === "GET",
    ).length,
    activityReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/activity" && method === "GET",
    ).length,
    activityRows: Array.from(document.querySelectorAll('[data-testid^="activity-"]'))
      .map((row) => row.textContent?.trim() ?? "")
  })`);
  if (
    !failedMoveState.error?.includes("last confirmed location") ||
    !failedMoveState.toastText.includes("Failed to move engram") ||
    !failedMoveState.toastText.includes("The server blocked this move.") ||
    !failedMoveState.dialogOpen ||
    !failedMoveState.alphaHasMira ||
    failedMoveState.betaHasMira ||
    failedMoveState.presence[0]?.spaceId !== 101 ||
    failedMoveState.presenceReads !== hubQueriesBeforeMove.presenceReads ||
    failedMoveState.activityReads !== hubQueriesBeforeMove.activityReads ||
    JSON.stringify(failedMoveState.activityRows) !== JSON.stringify(hubQueriesBeforeMove.activityRows)
  ) {
    throw new Error(`Failed Hub move changed the confirmed location or hid its explanation: ${JSON.stringify(failedMoveState)}`);
  }
  await click(
    `document.querySelector('[data-testid="button-retry-move"]')`,
    "retry Hub move after server error",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="hub-move-error"]')) &&
      window.__hubMoveFixture.moveRequests.length === 2 &&
      Array.from(document.querySelectorAll('[data-state="open"].destructive'))
        .some((toast) => toast.innerText.includes("The move was not recorded."))`,
    "translated fallback Hub move error toast",
  );
  const fallbackMoveState = await devtools.evaluate(`({
    dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
    toastText: Array.from(document.querySelectorAll('[data-state="open"].destructive'))
      .map((toast) => toast.innerText)
      .join(" "),
    presence: window.__hubMoveFixture.presence,
    presenceReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/presence" && method === "GET",
    ).length,
    activityReads: window.__groupChatFixture.requests.filter(
      ({ pathname, method }) => pathname === "/api/hub/activity" && method === "GET",
    ).length,
    activityRows: Array.from(document.querySelectorAll('[data-testid^="activity-"]'))
      .map((row) => row.textContent?.trim() ?? "")
  })`);
  if (
    !fallbackMoveState.dialogOpen ||
    !fallbackMoveState.toastText.includes("The move was not recorded.") ||
    fallbackMoveState.presence[0]?.spaceId !== 101 ||
    fallbackMoveState.presenceReads !== hubQueriesBeforeMove.presenceReads ||
    fallbackMoveState.activityReads !== hubQueriesBeforeMove.activityReads ||
    JSON.stringify(fallbackMoveState.activityRows) !== JSON.stringify(hubQueriesBeforeMove.activityRows)
  ) {
    throw new Error(`Hub fallback failure changed confirmed state or hid the retry: ${JSON.stringify(fallbackMoveState)}`);
  }
  await click(
    `document.querySelector('[data-testid="button-retry-move"]')`,
    "retry Hub move after fallback error",
  );
  await waitFor(
    `window.__hubMoveFixture.moveRequests.length === 3 &&
      window.__hubMoveFixture.presence[0]?.spaceId === 202 &&
      Boolean(document.querySelector('[data-testid="card-space-commons-beta"] [data-testid="occupant-1"]')) &&
      !document.querySelector('[role="dialog"]')`,
    "successful Hub move retry",
  );
  const retriedMoveState = await devtools.evaluate(`({
    requests: window.__hubMoveFixture.moveRequests,
    alphaHasMira: Boolean(document.querySelector('[data-testid="card-space-commons-alpha"] [data-testid="occupant-1"]')),
    betaHasMira: Boolean(document.querySelector('[data-testid="card-space-commons-beta"] [data-testid="occupant-1"]'))
  })`);
  if (
    JSON.stringify(retriedMoveState.requests[0]) !== JSON.stringify(retriedMoveState.requests[1]) ||
    JSON.stringify(retriedMoveState.requests[1]) !== JSON.stringify(retriedMoveState.requests[2]) ||
    retriedMoveState.alphaHasMira ||
    !retriedMoveState.betaHasMira
  ) {
    throw new Error(`Hub retry changed its request or failed to show the confirmed destination: ${JSON.stringify(retriedMoveState)}`);
  }
  await click(
    `document.querySelector('[data-testid="button-relocate"]')`,
    "reopen Hub move dialog after success",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="select-move-engram"]'))`,
    "reopened Hub move dialog",
  );
  if (await devtools.evaluate(`Boolean(document.querySelector('[data-testid="hub-move-error"]'))`)) {
    throw new Error("A successful Hub move left the previous failure message visible");
  }
  await devtools.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
  await devtools.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape" });
  await waitFor(`!document.querySelector('[role="dialog"]')`, "closed reopened Hub move dialog");

  const feedBeforeTranscript = await hubActivitySnapshot();
  await click(
    `document.querySelector('[data-testid="button-open-transcript-1"]')`,
    "open Commons Alpha transcript",
  );
  await waitFor(
    `document.querySelector('[data-testid="hub-transcript-scroll-101"]')?.getAttribute("aria-busy") === "true"`,
    "Commons transcript loading state",
  );
  const feedWhileLoading = await hubActivitySnapshot();
  if (JSON.stringify(feedWhileLoading) !== JSON.stringify(feedBeforeTranscript)) {
    throw new Error(`Opening the transcript changed the Hub activity feed: ${JSON.stringify({
      before: feedBeforeTranscript,
      duringLoading: feedWhileLoading,
    })}`);
  }

  const releasedInitialTranscript = await devtools.evaluate(
    "window.__hubTranscriptFixture.releaseHeldTranscript()",
  );
  if (!releasedInitialTranscript) {
    throw new Error("The pending Commons transcript fixture response was not available to release");
  }
  await waitFor(
    `Boolean(document.querySelector('[data-testid="transcript-message-20"]'))`,
    "populated Commons Alpha transcript",
  );
  const populatedLabels = await devtools.evaluate(
    `document.querySelector('[data-testid="transcript-message-1"]')?.innerText ?? null`,
  );
  const feedAfterPopulatedTranscript = await hubActivitySnapshot();
  if (
    !populatedLabels?.includes("Mira") ||
    !populatedLabels.includes("Aster") ||
    JSON.stringify(feedAfterPopulatedTranscript) !== JSON.stringify(feedBeforeTranscript)
  ) {
    throw new Error(`The populated transcript lost speaker labels or changed the activity feed: ${JSON.stringify({
      labels: populatedLabels,
      feedBefore: feedBeforeTranscript,
      feedAfter: feedAfterPopulatedTranscript,
    })}`);
  }

  const initialTranscriptScroll = await devtools.evaluate(`(() => {
    const container = document.querySelector('[data-testid="hub-transcript-scroll-101"]');
    if (!container) return null;
    return {
      distanceFromBottom: container.scrollHeight - container.clientHeight - container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight
    };
  })()`);
  if (
    !initialTranscriptScroll ||
    initialTranscriptScroll.scrollHeight <= initialTranscriptScroll.clientHeight ||
    initialTranscriptScroll.distanceFromBottom > 24
  ) {
    throw new Error(`Opening the Commons transcript did not start at the newest turn: ${JSON.stringify(initialTranscriptScroll)}`);
  }

  const readsBeforeFirstTurn = await devtools.evaluate(
    "window.__hubTranscriptFixture.readCount(101)",
  );
  await devtools.evaluate(
    "window.__hubTranscriptFixture.addTurn(101, 'Alpha live turn 21')",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="transcript-message-21"]')) && window.__hubTranscriptFixture.readCount(101) > ${readsBeforeFirstTurn}`,
    "Commons transcript polling picked up a new turn",
    12000,
  );
  const scrolledToNewestTurn = await devtools.evaluate(`(() => {
    const container = document.querySelector('[data-testid="hub-transcript-scroll-101"]');
    return container
      ? container.scrollHeight - container.clientHeight - container.scrollTop
      : null;
  })()`);
  if (scrolledToNewestTurn === null || scrolledToNewestTurn > 24) {
    throw new Error(`A transcript already at the newest turn did not follow the new turn: ${scrolledToNewestTurn}`);
  }

  const anchorBeforeRefresh = await devtools.evaluate(`(() => {
    const container = document.querySelector('[data-testid="hub-transcript-scroll-101"]');
    const anchor = container?.querySelector('[data-transcript-message-id="8"]');
    if (!container || !anchor) return null;
    const desiredOffset = 28;
    container.scrollTop +=
      anchor.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      desiredOffset;
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    return {
      offset: anchor.getBoundingClientRect().top - container.getBoundingClientRect().top,
      scrollTop: container.scrollTop
    };
  })()`);
  if (!anchorBeforeRefresh || Math.abs(anchorBeforeRefresh.offset - 28) > 3) {
    throw new Error(`Could not position the transcript on a stable older turn: ${JSON.stringify(anchorBeforeRefresh)}`);
  }

  const readsBeforeSecondTurn = await devtools.evaluate(
    "window.__hubTranscriptFixture.readCount(101)",
  );
  await devtools.evaluate(
    "window.__hubTranscriptFixture.addTurn(101, 'Alpha live turn 22')",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="transcript-message-22"]')) && window.__hubTranscriptFixture.readCount(101) > ${readsBeforeSecondTurn}`,
    "Commons transcript polling preserved a scrolled-up position",
    12000,
  );
  const anchorAfterRefresh = await devtools.evaluate(`(() => {
    const container = document.querySelector('[data-testid="hub-transcript-scroll-101"]');
    const anchor = container?.querySelector('[data-transcript-message-id="8"]');
    return container && anchor
      ? anchor.getBoundingClientRect().top - container.getBoundingClientRect().top
      : null;
  })()`);
  if (
    anchorAfterRefresh === null ||
    Math.abs(anchorAfterRefresh - anchorBeforeRefresh.offset) > 3
  ) {
    throw new Error(`Transcript refresh moved the visible older turn: ${JSON.stringify({
      before: anchorBeforeRefresh,
      after: anchorAfterRefresh,
    })}`);
  }

  const alphaTranscriptSpaces = await devtools.evaluate(
    "window.__hubTranscriptFixture.transcriptSpaceIds",
  );
  if (
    alphaTranscriptSpaces.length < 3 ||
    alphaTranscriptSpaces.some((spaceId) => spaceId !== 101)
  ) {
    throw new Error(`Commons Alpha transcript requested the wrong space: ${JSON.stringify(alphaTranscriptSpaces)}`);
  }

  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent?.trim() === "Close")`,
    "close Commons Alpha transcript",
  );
  await waitFor(`!document.querySelector('[role="dialog"]')`, "closed Commons Alpha transcript");
  await click(
    `document.querySelector('[data-testid="button-open-transcript-2"]')`,
    "open Commons Beta transcript",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="transcript-message-2021"]'))`,
    "Commons Beta transcript",
  );
  const betaTranscript = await devtools.evaluate(`({
    body: document.querySelector('[role="dialog"]')?.innerText,
    transcriptSpaces: window.__hubTranscriptFixture.transcriptSpaceIds
  })`);
  if (
    !betaTranscript.body?.includes("Beta space transcript only") ||
    betaTranscript.body.includes("Alpha live turn") ||
    betaTranscript.transcriptSpaces.at(-1) !== 202
  ) {
    throw new Error(`Commons Beta showed a transcript from the wrong space: ${JSON.stringify(betaTranscript)}`);
  }

  await devtools.evaluate('window.__hubTranscriptFixture.setScenario("empty")');
  await reloadFixtureDocument("empty Commons transcript fixture");
  await waitFor(
    `Boolean(document.querySelector('[data-testid="button-open-transcript-1"]'))`,
    "Hub activity feed for empty transcript",
  );
  const feedBeforeEmptyTranscript = await hubActivitySnapshot();
  await click(
    `document.querySelector('[data-testid="button-open-transcript-1"]')`,
    "open empty Commons transcript",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="hub-transcript-empty-101"]'))`,
    "empty Commons transcript state",
  );
  const feedAfterEmptyTranscript = await hubActivitySnapshot();
  if (JSON.stringify(feedAfterEmptyTranscript) !== JSON.stringify(feedBeforeEmptyTranscript)) {
    throw new Error(`Opening an empty transcript changed the Hub activity feed: ${JSON.stringify({
      before: feedBeforeEmptyTranscript,
      after: feedAfterEmptyTranscript,
    })}`);
  }

  await devtools.evaluate('window.__hubTranscriptFixture.setScenario("foreign")');
  await reloadFixtureDocument("foreign-space Commons transcript fixture");
  await waitFor(
    `Boolean(document.querySelector('[data-testid="button-open-transcript-1"]'))`,
    "Hub activity feed for foreign-space failure",
  );
  const feedBeforeForeignTranscript = await hubActivitySnapshot();
  await click(
    `document.querySelector('[data-testid="button-open-transcript-1"]')`,
    "open denied Commons transcript",
  );
  await waitFor(
    `Boolean(document.querySelector('[data-testid="hub-transcript-error-101"]'))`,
    "foreign-space transcript failure state",
    20000,
  );
  const failedTranscriptState = await devtools.evaluate(`({
    feedRows: Array.from(document.querySelectorAll('[data-testid^="activity-"]')).map((row) => ({
      id: row.getAttribute("data-testid"),
      text: row.innerText,
    })),
    transcriptReads: window.__hubTranscriptFixture.readCount(101),
    errorText: document.querySelector('[data-testid="hub-transcript-error-101"]')?.innerText
  })`);
  if (
    failedTranscriptState.transcriptReads < 1 ||
    !failedTranscriptState.errorText ||
    JSON.stringify(failedTranscriptState.feedRows) !== JSON.stringify(feedBeforeForeignTranscript)
  ) {
    throw new Error(`A denied foreign-space transcript changed the Hub activity feed or hid its error: ${JSON.stringify({
      before: feedBeforeForeignTranscript,
      after: failedTranscriptState,
    })}`);
  }

  console.log("Group chat and Hub transcript browser regressions passed");
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