import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9229);
const downloadsDir = await mkdtemp(join(tmpdir(), "engram-chat-downloads-"));
const profileDir = await mkdtemp(join(tmpdir(), "engram-chat-profile-"));

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
          }
          else pending.resolve(message.result);
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
  let archived = false;
  const conversation = {
    id: 1,
    title: "Browser Archive Room",
    mode: "companion",
    personaName: "Aster",
    engramId: 1,
    engramIds: [1, 2],
    createdAt: "2026-09-05T12:00:00.000Z",
    archivedAt: null,
  };
  const messages = [
    { id: 1, role: "user", content: "Human hello", createdAt: "2026-09-05T12:01:00.000Z" },
    { id: 2, role: "context", content: "Context clue", createdAt: "2026-09-05T12:02:00.000Z" },
    { id: 3, role: "assistant", speakerEngramId: 2, content: "Aster group reply", createdAt: "2026-09-05T12:03:00.000Z" },
  ];
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const currentConversation = () => ({
    ...conversation,
    archivedAt: archived ? "2026-09-05T12:10:00.000Z" : null,
  });
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")).toUpperCase();
    if (url.includes("/api/engrams")) {
      return response([
        { id: 1, name: "PYRI", isArchival: false, isChatActive: true },
        { id: 2, name: "Aster", isArchival: false, isChatActive: true },
      ]);
    }
    if (url.includes("/api/openai/conversations/1/archive") && method === "PATCH") {
      archived = JSON.parse(init.body ?? "{}").archived === true;
      return response(currentConversation());
    }
    if (url.includes("/api/openai/conversations/1") && method === "GET") {
      return response({ ...currentConversation(), messages });
    }
    if (url.includes("/api/openai/conversations") && method === "GET") {
      const wantsArchived = new URL(url, window.location.origin).searchParams.get("archived") === "true";
      return response(wantsArchived === archived ? [currentConversation()] : []);
    }
    if (url.includes("/api/events")) return response({});
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
  if (!clicked) {
    const available = await devtools.evaluate(
      `Array.from(document.querySelectorAll('[role],button')).map((node) => ({ role: node.getAttribute('role'), text: node.textContent?.trim(), label: node.getAttribute('aria-label') })).filter((item) => item.text || item.label)`,
    );
    throw new Error(`Could not click ${label}; available controls: ${JSON.stringify(available)}`);
  }
}

function contentFor(file) {
  if (file.endsWith(".pdf")) {
    return spawnSync("pdftotext", [file, "-"], { encoding: "utf8" }).stdout;
  }
  if (file.endsWith(".docx")) {
    return spawnSync("unzip", ["-p", file, "word/document.xml"], { encoding: "utf8" }).stdout;
  }
  return readFileSync(file, "utf8");
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  await devtools.call("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsDir,
  });
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: fixtureScript,
  });
  await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  await waitFor(`Boolean(document.body?.innerText.includes("Browser Archive Room"))`, "signed-in chat fixture");
  await click(
    `Array.from(document.querySelectorAll('[role="button"]')).find((node) => node.textContent.includes("Browser Archive Room"))`,
    "fixture conversation",
  );
  await waitFor(`Boolean(document.body?.innerText.includes("Human hello"))`, "conversation transcript");

  const requiredMessages = ["Browser Archive Room", "Human hello", "Context clue", "Aster group reply"];
  const visibleText = await devtools.evaluate("document.body.innerText");
  for (const message of requiredMessages) {
    if (!visibleText.includes(message)) throw new Error(`Missing visible transcript text: ${message}`);
  }

  await click(`document.querySelector('[aria-label="Download conversation"]')`, "download menu");
  for (const format of ["Markdown", "plain text", "PDF", "DOCX"]) {
    await waitFor(`Boolean(document.querySelector('[role="menuitem"]'))`, `${format} export menu`);
    await click(
      `Array.from(document.querySelectorAll('[role="menuitem"]')).find((node) => node.textContent.includes(${JSON.stringify(format)}))`,
      `${format} export`,
    );
    await delay(300);
    if (format !== "DOCX") {
      await click(`document.querySelector('[aria-label="Download conversation"]')`, "download menu");
    }
  }

  await waitFor(`Boolean(document.querySelector('[aria-label="Archive conversation"]'))`, "archive control");
  await click(`document.querySelector('[aria-label="Archive conversation"]')`, "archive conversation");
  await waitFor(`document.querySelector('textarea')?.disabled === true`, "archived read-only composer");
  if (!(await devtools.evaluate(`document.body.innerText.includes("restore it to send")`))) {
    throw new Error("Archived conversation did not show its read-only state");
  }

  await click(`document.querySelector('[aria-label="Show archived conversations"]')`, "archived conversation view");
  await waitFor(`Boolean(document.querySelector('[aria-label="Show active conversations"]'))`, "archived conversation view");
  await waitFor(`Array.from(document.querySelectorAll("h2")).some((node) => node.textContent.includes("Archived conversations"))`, "archived list heading");
  await waitFor(`document.body?.textContent?.includes("Browser Archive Room") === true`, "archived conversation list item");
  await click(`document.querySelector('[aria-label="Restore conversation"]')`, "restore conversation");
  await waitFor(`document.querySelector('textarea')?.disabled === false`, "restored composer");

  const files = readdirSync(downloadsDir).filter((name) => !name.endsWith(".crdownload"));
  const expectedExtensions = [".md", ".txt", ".pdf", ".docx"];
  for (const extension of expectedExtensions) {
    const file = files.find((name) => name.endsWith(extension));
    if (!file) throw new Error(`Missing ${extension} download`);
    const content = contentFor(join(downloadsDir, file));
    for (const message of requiredMessages) {
      if (!content.includes(message)) throw new Error(`${file} is missing ${message}`);
    }
  }
  console.log(`Browser regression passed: ${files.join(", ")}`);
} finally {
  devtools.close();
  if (!chrome.killed) chrome.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => chrome.once("exit", resolve)),
    delay(2000),
  ]);
  for (const directory of [profileDir, downloadsDir]) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(directory, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await delay(100);
      }
    }
  }
}