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
  const persist = () => window.localStorage.setItem(storageKey, JSON.stringify(state));
  window.__groupChatFixture = {
    get instanceId() { return fixtureInstanceId; },
    requests,
    get createBody() { return state.createBody; },
    get conversation() { return state.conversation; },
    get messageCount() { return state.messages.length; },
    get autonomousCount() {
      return state.messages.filter((message) => message.autonomous === true).length;
    },
    showConversationInList() {
      state.showInList = true;
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
  const response = (body, status = 200, headers = { "Content-Type": "application/json" }) =>
    new Response(JSON.stringify(body), { status, headers });
  const currentConversation = () => ({
    ...state.conversation,
    engramIds: [1, 2],
    groupContinuationMode: state.conversation?.groupContinuationMode ?? "short",
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

  console.log("Group chat browser regression passed");
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