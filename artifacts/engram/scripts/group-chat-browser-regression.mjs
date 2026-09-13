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
    : { showInList: false, conversation: null, messages: [], createBody: null };
  const requests = [];
  const engrams = [
    { id: 1, name: "Mira", title: "Signal Cartographer", symbol: "◇", isArchival: false, isChatActive: true },
    { id: 2, name: "Aster", title: "Night Analyst", symbol: "△", isArchival: false, isChatActive: true },
  ];
  const persist = () => window.localStorage.setItem(storageKey, JSON.stringify(state));
  window.__groupChatFixture = {
    requests,
    get createBody() { return state.createBody; },
    get conversation() { return state.conversation; },
    get messageCount() { return state.messages.length; },
    showConversationInList() {
      state.showInList = true;
      persist();
    },
  };
  const response = (body, status = 200, headers = { "Content-Type": "application/json" }) =>
    new Response(JSON.stringify(body), { status, headers });
  const currentConversation = () => ({
    ...state.conversation,
    engramIds: [1, 2],
    groupContinuationMode: "short",
  });
  const sse = (events) =>
    new Response(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""), {
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
      const replies = [
        { speakerEngramId: 1, content: "Mira initial group reply" },
        { speakerEngramId: 2, content: "Aster initial group reply" },
        { speakerEngramId: 1, content: "Mira autonomous peer reply" },
      ];
      for (const reply of replies) {
        state.messages.push({
          id: state.messages.length + 1,
          role: "assistant",
          ...reply,
          createdAt: "2026-09-12T12:01:01.000Z",
        });
      }
      persist();
      return sse([...replies, { done: true }]);
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

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: fixtureScript,
  });
  await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  await waitFor(`Boolean(document.body?.innerText.includes("CONVERSATIONS"))`, "chat page");

  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-plus"))`,
    "new conversation",
  );
  await waitFor(`Boolean(document.querySelector('[role="dialog"]'))`, "new conversation dialog");
  await waitFor(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).some((node) => node.textContent?.includes("Mira"))`,
    "Mira participant option",
  );
  await fill(`document.querySelector('[role="dialog"] input')`, "First Message Group", "conversation title");
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.includes("Mira"))`,
    "Mira participant",
  );
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.includes("Aster"))`,
    "Aster participant",
  );
  await click(
    `Array.from(document.querySelectorAll('[role="dialog"] button')).find((node) => node.textContent?.toLowerCase().includes("start conversation"))`,
    "start group conversation",
  );

  await waitFor(`Boolean(document.querySelector("textarea") && !document.querySelector("textarea").disabled)`, "group composer");
  const createBody = await devtools.evaluate("window.__groupChatFixture.createBody");
  if (
    JSON.stringify(createBody?.engramIds) !== JSON.stringify([1, 2]) ||
    createBody?.groupContinuationMode !== "short"
  ) {
    throw new Error(`Group creation did not submit both participants and continuation consent: ${JSON.stringify(createBody)}`);
  }

  await fill(`document.querySelector("textarea")`, "Begin the first group exchange.", "first group message");
  await click(`Array.from(document.querySelectorAll("button")).find((node) => node.querySelector("svg")?.className?.baseVal?.includes("lucide-send"))`, "send first group message");
  await waitFor(`Boolean(document.body?.innerText.includes("Mira initial group reply"))`, "Mira initial reply");
  await waitFor(`Boolean(document.body?.innerText.includes("Aster initial group reply"))`, "Aster initial reply");
  await waitFor(`Boolean(document.body?.innerText.includes("Mira autonomous peer reply"))`, "autonomous peer reply");

  for (const [label, content] of [
    ["MIRA · ◇", "Mira initial group reply"],
    ["ASTER · △", "Aster initial group reply"],
    ["MIRA · ◇", "Mira autonomous peer reply"],
  ]) {
    if (!(await labeledMessageVisible(label, content))) {
      throw new Error(`Reply was not labeled with ${label}: ${content}`);
    }
  }

  await devtools.evaluate("window.__groupChatFixture.showConversationInList()");
  await devtools.call("Page.reload");
  await waitFor(`Boolean(document.body?.innerText.includes("First Message Group"))`, "conversation after reload");
  await click(
    `Array.from(document.querySelectorAll("button")).find((node) => node.textContent?.toLowerCase().includes("first message group"))`,
    "reloaded group conversation",
  );
  await waitFor(`Boolean(document.body?.innerText.includes("Mira autonomous peer reply"))`, "reloaded autonomous reply");
  const reloadedText = await devtools.evaluate("document.body.innerText");
  for (const text of ["MIRA · ◇", "ASTER · △", "Mira initial group reply", "Aster initial group reply"]) {
    if (!reloadedText.includes(text)) throw new Error(`Reloaded transcript is missing ${text}`);
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