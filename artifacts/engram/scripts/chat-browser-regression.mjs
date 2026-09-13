import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const realClerkMode = process.env.ENGRAM_BROWSER_REAL_CLERK === "true";
const appUrl =
  process.env.ENGRAM_BROWSER_TEST_URL ??
  (realClerkMode
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "http://127.0.0.1:5188");
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9229);
const downloadsDir = await mkdtemp(join(tmpdir(), "engram-chat-downloads-"));
const profileDir = await mkdtemp(join(tmpdir(), "engram-chat-profile-"));
let disposableClerk;
let realConversationId;
let realConversationTitle;
const chromiumPath =
  process.env.CHROMIUM_PATH ??
  ["/repl/tools/bin/chromium", "chromium", "chromium-browser", "google-chrome"]
    .map((candidate) => {
      if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
      const result = spawnSync("which", [candidate], { encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : "";
    })
    .find(Boolean);

if (!chromiumPath) {
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH or install chromium.");
}

const chrome = spawn(
  chromiumPath,
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
  const nestedButtonWarnings = [];
  for (const method of ["warn", "error"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      const text = args.map((arg) => typeof arg === "string" ? arg : String(arg)).join(" ");
      if (/nested|descendant|validateDOMNesting/i.test(text)) nestedButtonWarnings.push(text);
      original(...args);
    };
  }
  window.__engramChatFixture = {
    get nestedButtonWarnings() { return nestedButtonWarnings; },
  };
  const conversations = new Map([
    [1, {
      id: 1,
      title: "Browser Archive Room",
      mode: "companion",
      personaName: "Aster",
      engramId: 1,
      engramIds: [1, 2],
      createdAt: "2026-09-05T12:00:00.000Z",
    }],
    [2, {
      id: 2,
      title: "Browser Selection Room",
      mode: "companion",
      personaName: "PYRI",
      engramId: 1,
      engramIds: [1],
      createdAt: "2026-09-05T12:04:00.000Z",
    }],
    [3, {
      id: 3,
      title: "Browser Delete Room",
      mode: "companion",
      personaName: "PYRI",
      engramId: 1,
      engramIds: [1],
      createdAt: "2026-09-05T12:05:00.000Z",
    }],
  ]);
  const messageSets = new Map([
    [1, [
      { id: 1, role: "user", content: "Human hello", createdAt: "2026-09-05T12:01:00.000Z" },
      { id: 2, role: "context", content: "Context clue", createdAt: "2026-09-05T12:02:00.000Z" },
      { id: 3, role: "assistant", speakerEngramId: 2, content: "Aster group reply", createdAt: "2026-09-05T12:03:00.000Z" },
    ]],
    [2, [
      { id: 4, role: "user", content: "Selection room hello", createdAt: "2026-09-05T12:04:00.000Z" },
    ]],
    [3, [
      { id: 5, role: "user", content: "Delete room must stay closed", createdAt: "2026-09-05T12:05:00.000Z" },
    ]],
  ]);
  const archivedIds = new Set();
  const deletedIds = new Set();
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const currentConversation = (id) => {
    const conversation = conversations.get(id);
    if (!conversation || deletedIds.has(id)) return null;
    return {
      ...conversation,
      archivedAt: archivedIds.has(id) ? "2026-09-05T12:10:00.000Z" : null,
    };
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")).toUpperCase();
    if (url.includes("/api/engrams")) {
      return response([
        { id: 1, name: "PYRI", isArchival: false, isChatActive: true },
        { id: 2, name: "Aster", isArchival: false, isChatActive: true },
      ]);
    }
    const conversationMatch = url.match(/\/api\/openai\/conversations\/(\d+)(?:\/archive)?$/);
    if (conversationMatch) {
      const id = Number(conversationMatch[1]);
      if (method === "PATCH" && url.endsWith("/archive")) {
        if (!currentConversation(id)) return response({ error: "Not found" }, 404);
        const body = JSON.parse(init.body ?? "{}");
        if (body.archived === true) archivedIds.add(id);
        else archivedIds.delete(id);
        return response(currentConversation(id));
      }
      if (method === "DELETE") {
        if (!currentConversation(id)) return response({ error: "Not found" }, 404);
        deletedIds.add(id);
        return new Response(null, { status: 204 });
      }
      if (method === "GET") {
        const conversation = currentConversation(id);
        if (!conversation) return response({ error: "Not found" }, 404);
        return response({ ...conversation, messages: messageSets.get(id) ?? [] });
      }
    }
    if (url.includes("/api/openai/conversations") && method === "GET") {
      const wantsArchived = new URL(url, window.location.origin).searchParams.get("archived") === "true";
      return response(
        [...conversations.keys()]
          .map((id) => currentConversation(id))
          .filter((conversation) => conversation && Boolean(conversation.archivedAt) === wantsArchived),
      );
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

async function createDisposableClerkSession() {
  const secret = process.env.CLERK_SECRET_KEY;
  if (!secret || !process.env.REPLIT_DEV_DOMAIN) {
    throw new Error("Real Clerk browser checks require Clerk and preview-domain configuration");
  }
  const clerkHeaders = {
    Authorization: `Bearer ${secret}`,
    "Content-Type": "application/json",
  };
  const email = `engram-browser-check-${randomUUID()}@example.com`;
  const password = `E${randomUUID()}-browser-check-7!`;
  let userId;
  let sessionId;
  let signInTokenId;
  try {
    const userResponse = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({
        email_address: [email],
        password,
        first_name: "ENGRAM",
        last_name: "Browser Check",
      }),
    });
    if (!userResponse.ok) throw new Error(`Could not create disposable Clerk user (${userResponse.status})`);
    userId = (await userResponse.json()).id;

    const sessionResponse = await fetch("https://api.clerk.com/v1/sessions", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({ user_id: userId }),
    });
    if (!sessionResponse.ok) throw new Error(`Could not create disposable Clerk session (${sessionResponse.status})`);
    sessionId = (await sessionResponse.json()).id;

    const tokenResponse = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, {
      method: "POST",
      headers: clerkHeaders,
    });
    if (!tokenResponse.ok) throw new Error(`Could not mint disposable Clerk API token (${tokenResponse.status})`);
    const apiToken = (await tokenResponse.json()).jwt;

    const signInTokenResponse = await fetch("https://api.clerk.com/v1/sign_in_tokens", {
      method: "POST",
      headers: clerkHeaders,
      body: JSON.stringify({ user_id: userId, expires_in_seconds: 300 }),
    });
    if (!signInTokenResponse.ok) throw new Error(`Could not mint disposable Clerk sign-in token (${signInTokenResponse.status})`);
    const signInTokenBody = await signInTokenResponse.json();
    signInTokenId = signInTokenBody.id;

    return {
      userId,
      sessionId,
      signInTokenId,
      signInToken: signInTokenBody.token,
      apiToken,
      clerkHeaders,
    };
  } catch (error) {
    if (sessionId) {
      await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/revoke`, {
        method: "POST",
        headers: clerkHeaders,
      });
    }
    if (userId) {
      await fetch(`https://api.clerk.com/v1/users/${userId}`, {
        method: "DELETE",
        headers: clerkHeaders,
      });
    }
    throw error;
  }
}

async function realApi(path, session, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${session.apiToken}`);
  if (init.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(`${appUrl}${path}`, { ...init, headers });
  return response;
}

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
  if (realClerkMode) {
    disposableClerk = await createDisposableClerkSession();
  }
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  await devtools.call("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: downloadsDir,
  });
  if (!realClerkMode) {
    await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
      source: fixtureScript,
    });
    await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  } else {
    await devtools.call("Page.navigate", {
      url: `${appUrl}/sign-in?__clerk_ticket=${encodeURIComponent(disposableClerk.signInToken)}`,
    });
    await waitFor(`location.pathname === "/dashboard"`, "real Clerk sign-in", 15000);
    const authState = await devtools.evaluate(`(async () => {
      const userId = window.Clerk?.user?.id ?? null;
      const token = await window.Clerk?.session?.getToken?.();
      const response = await fetch("/api/openai/conversations", {
        headers: token ? { Authorization: "Bearer " + token } : {},
      });
      const body = response.ok ? await response.json() : [];
      return JSON.stringify({
        userPresent: Boolean(userId),
        userMatches: userId === ${JSON.stringify(disposableClerk.userId)},
        status: response.status,
        titles: body.map((conversation) => conversation.title),
      });
    })()`);
    const parsedAuthState = JSON.parse(authState);
    if (!parsedAuthState.userMatches || parsedAuthState.status !== 200) {
      throw new Error(`Real Clerk browser session mismatch: ${authState}`);
    }
    const createdConversation = JSON.parse(await devtools.evaluate(`(async () => {
      const token = await window.Clerk.session.getToken();
      const title = "Real Clerk Archive Check " + crypto.randomUUID().slice(0, 8);
      const response = await fetch("/api/openai/conversations", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, mode: "companion" }),
      });
      return JSON.stringify({
        status: response.status,
        body: await response.json(),
      });
    })()`));
    if (createdConversation.status !== 201) {
      throw new Error(`Real Clerk conversation creation failed (${createdConversation.status})`);
    }
    realConversationId = createdConversation.body.id;
    realConversationTitle = createdConversation.body.title;
    const seededMessage = JSON.parse(await devtools.evaluate(`(async () => {
      const token = await window.Clerk.session.getToken();
      const response = await fetch("/api/openai/conversations/${realConversationId}/messages", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: "Real Clerk export fixture message" }),
      });
      return JSON.stringify({
        status: response.status,
        responseBytes: (await response.text()).length,
      });
    })()`));
    if (seededMessage.status !== 200) {
      throw new Error(`Real Clerk message creation failed (${seededMessage.status})`);
    }
    await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  }
  const conversationTitle = realClerkMode ? realConversationTitle : "Browser Archive Room";
  await waitFor(
    `Boolean(document.body?.innerText.includes(${JSON.stringify(conversationTitle)}))`,
    "chat conversation list",
    15000,
  );
  if (!realClerkMode) {
    for (const title of ["Browser Archive Room", "Browser Selection Room", "Browser Delete Room"]) {
      await waitFor(`Boolean(document.body?.innerText.includes(${JSON.stringify(title)}))`, `${title} list row`);
    }

    const selectionControl = `Array.from(document.querySelectorAll('[role="button"],button')).find((node) => node.textContent.includes("Browser Selection Room"))`;
    if (!(await devtools.evaluate(`(() => {
      const node = ${selectionControl};
      return node?.tagName === "BUTTON" && node.getAttribute("type") === "button";
    })()`))) {
      throw new Error("Conversation selection control is not a native button");
    }
    await click(selectionControl, "selection conversation pointer control");
  await waitFor(`Boolean(document.body?.innerText.includes("Selection room hello"))`, "selected conversation transcript");
  if (!(await devtools.evaluate(`document.body.innerText.includes("Browser Selection Room")`))) {
    throw new Error("Selecting a conversation did not show its active title");
  }

  const rowAction = (ariaLabel, title) =>
    `Array.from(document.querySelectorAll('[aria-label="${ariaLabel}"]')).find((node) => node.parentElement?.parentElement?.textContent?.includes(${JSON.stringify(title)}))`;
  await click(rowAction("Delete conversation", "Browser Delete Room"), "delete inactive conversation");
  await waitFor(`!document.body?.innerText.includes("Browser Delete Room")`, "deleted conversation removed from list");
  if (!(await devtools.evaluate(`document.body.innerText.includes("Selection room hello")`))) {
    throw new Error("Deleting an inactive conversation opened or replaced the active conversation");
  }
  console.log("Chat conversation controls check: inactive row delete kept selection open");

  await click(rowAction("Archive conversation", "Browser Archive Room"), "archive inactive conversation");
  await waitFor(`!document.body?.innerText.includes("Browser Archive Room")`, "archived conversation removed from active list");
  if (!(await devtools.evaluate(`document.body.innerText.includes("Selection room hello")`))) {
    throw new Error("Archiving an inactive conversation opened or replaced the active conversation");
  }
  await click(`document.querySelector('[aria-label="Show archived conversations"]')`, "archived conversation view");
  await waitFor(`Boolean(document.querySelector('[aria-label="Show active conversations"]'))`, "archived conversation view");
  await waitFor(`Boolean(document.body?.innerText.includes("Browser Archive Room"))`, "archived row");
  await click(rowAction("Restore conversation", "Browser Archive Room"), "restore inactive conversation");
  await waitFor(`!document.body?.innerText.includes("Browser Archive Room")`, "restored conversation removed from archived list");
  if (!(await devtools.evaluate(`document.body.innerText.includes("Selection room hello")`))) {
    throw new Error("Restoring an inactive conversation opened or replaced the active conversation");
  }
  await click(`document.querySelector('[aria-label="Show active conversations"]')`, "active conversation view");
  await waitFor(`Boolean(document.body?.innerText.includes("Browser Archive Room"))`, "restored active-list row");
    console.log("Chat conversation controls check: inactive row archive/restore kept selection open");
  }

  await click(
    `Array.from(document.querySelectorAll('[role="button"],button')).find((node) => node.textContent.includes(${JSON.stringify(conversationTitle)}))`,
    "conversation",
  );
  if (!realClerkMode) {
    await waitFor(`Boolean(document.body?.innerText.includes("Human hello"))`, "conversation transcript");
  } else {
    await waitFor(`document.querySelector('textarea') !== null`, "real conversation composer");
    await waitFor(
      `Boolean(document.body?.innerText.includes("Real Clerk export fixture message"))`,
      "real conversation transcript",
      15000,
    );
  }

  const requiredMessages = realClerkMode
    ? [conversationTitle, "Real Clerk export fixture message"]
    : ["Browser Archive Room", "Human hello", "Context clue", "Aster group reply"];
  const visibleText = await devtools.evaluate("document.body.innerText");
  for (const message of requiredMessages) {
    if (!visibleText.includes(message)) throw new Error(`Missing visible transcript text: ${message}`);
  }

  await click(`document.querySelector('[aria-label="Download conversation"]')`, "download menu");
  for (const format of ["Markdown", "plain text", "PDF", "DOCX"]) {
    console.log(`Chat archive/export check: export format=${format}`);
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
  console.log("Chat archive/export check: archive state=active -> archived");
  await click(`document.querySelector('[aria-label="Archive conversation"]')`, "archive conversation");
  await waitFor(`document.querySelector('textarea')?.disabled === true`, "archived read-only composer");
  if (!(await devtools.evaluate(`document.body.innerText.includes("restore it to send")`))) {
    throw new Error("Archived conversation did not show its read-only state");
  }
  if (realClerkMode) {
    const archivedSend = await realApi(
      `/api/openai/conversations/${realConversationId}/messages`,
      disposableClerk,
      {
        method: "POST",
        body: JSON.stringify({ content: "This archived send must be rejected" }),
      },
    );
    if (archivedSend.status !== 409) {
      throw new Error(`Archived send returned ${archivedSend.status}, expected 409`);
    }
  }

  await click(`document.querySelector('[aria-label="Show archived conversations"]')`, "archived conversation view");
  await waitFor(`Boolean(document.querySelector('[aria-label="Show active conversations"]'))`, "archived conversation view");
  await waitFor(`Array.from(document.querySelectorAll("h2")).some((node) => node.textContent.includes("Archived conversations"))`, "archived list heading");
  await waitFor(
    `document.body?.textContent?.includes(${JSON.stringify(conversationTitle)}) === true`,
    "archived conversation list item",
  );
  await click(`document.querySelector('[aria-label="Restore conversation"]')`, "restore conversation");
  await waitFor(`document.querySelector('textarea')?.disabled === false`, "restored composer");
  console.log("Chat archive/export check: archive state=archived -> restored");

  const files = readdirSync(downloadsDir).filter((name) => !name.endsWith(".crdownload"));
  const expectedExtensions = [".md", ".txt", ".pdf", ".docx"];
  for (const extension of expectedExtensions) {
    const file = files.find((name) => name.endsWith(extension));
    if (!file) throw new Error(`export format=${extension}: missing download`);
    const content = contentFor(join(downloadsDir, file));
    for (const message of requiredMessages) {
      if (!content.includes(message)) {
        throw new Error(`export format=${extension}: ${file} is missing transcript text "${message}"`);
      }
    }
  }
  const nestedButtonWarnings = await devtools.evaluate("window.__engramChatFixture?.nestedButtonWarnings ?? []");
  if (nestedButtonWarnings.length > 0) {
    throw new Error(`Nested-button browser warnings: ${JSON.stringify(nestedButtonWarnings)}`);
  }
  console.log("Chat conversation controls check: no nested-button console warnings");
  console.log(`Browser regression passed: ${files.join(", ")}`);
} finally {
  if (realClerkMode && disposableClerk) {
    if (realConversationId) {
      await realApi(`/api/openai/conversations/${realConversationId}`, disposableClerk, {
        method: "DELETE",
      }).catch(() => {});
    }
    await fetch(`https://api.clerk.com/v1/sign_in_tokens/${disposableClerk.signInTokenId}/revoke`, {
      method: "POST",
      headers: disposableClerk.clerkHeaders,
    }).catch(() => {});
    await fetch(`https://api.clerk.com/v1/sessions/${disposableClerk.sessionId}/revoke`, {
      method: "POST",
      headers: disposableClerk.clerkHeaders,
    }).catch(() => {});
    await fetch(`https://api.clerk.com/v1/users/${disposableClerk.userId}`, {
      method: "DELETE",
      headers: disposableClerk.clerkHeaders,
    }).catch(() => {});
  }
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