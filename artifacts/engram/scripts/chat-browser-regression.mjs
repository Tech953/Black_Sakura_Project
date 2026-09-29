import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const realClerkMode = process.env.ENGRAM_BROWSER_REAL_CLERK === "true";
const appUrl =
  process.env.ENGRAM_BROWSER_TEST_URL ??
  (realClerkMode
    ? process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : undefined
    : undefined);
const configuredDebugPort = process.env.ENGRAM_BROWSER_DEBUG_PORT
  ? Number(process.env.ENGRAM_BROWSER_DEBUG_PORT)
  : null;

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

if (!appUrl) {
  throw new Error(
    "Set ENGRAM_BROWSER_TEST_URL for local browser checks, or REPLIT_DEV_DOMAIN for real Clerk checks.",
  );
}
if (
  configuredDebugPort !== null &&
  (!Number.isInteger(configuredDebugPort) ||
    configuredDebugPort < 1 ||
    configuredDebugPort > 65535)
) {
  throw new Error(
    `ENGRAM_BROWSER_DEBUG_PORT must be an integer between 1 and 65535; received "${process.env.ENGRAM_BROWSER_DEBUG_PORT}"`,
  );
}
const debugPort = configuredDebugPort ?? (await findFreePort());
const downloadsDir = await mkdtemp(join(tmpdir(), "engram-chat-downloads-"));
const profileDir = await mkdtemp(join(tmpdir(), "engram-chat-profile-"));
let disposableClerk;
const realConversations = [];
let exportConversation;
let selectionConversation;
let deleteConversation;
const realFixtureUserMessage = "Real Clerk export fixture message";
const realFixtureAssistantMessage = "Real Clerk export fixture reply";
const realSelectionUserMessage = "Real Clerk selection fixture message";
const realSelectionAssistantMessage = "Real Clerk selection fixture reply";
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
    [4, {
      id: 4,
      title: "Browser Failed Delete Room",
      mode: "companion",
      personaName: "PYRI",
      engramId: 1,
      engramIds: [1],
      createdAt: "2026-09-05T12:06:00.000Z",
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
    [4, [
      { id: 6, role: "user", content: "Failed delete room must remain visible", createdAt: "2026-09-05T12:06:00.000Z" },
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
        if (id === 4) return response({ error: "Delete service unavailable" }, 503);
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

async function createRealConversation(label) {
  const title = `Real Clerk ${label} ${randomUUID().slice(0, 8)}`;
  const created = JSON.parse(await devtools.evaluate(`(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch("/api/openai/conversations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: ${JSON.stringify(title)}, mode: "companion" }),
    });
    return JSON.stringify({ status: response.status, body: await response.json() });
  })()`));
  if (created.status !== 201 || !Number.isSafeInteger(created.body?.id)) {
    throw new Error(`Real Clerk conversation creation failed (${created.status})`);
  }
  const conversation = {
    id: created.body.id,
    title: created.body.title ?? title,
  };
  realConversations.push(conversation);
  return conversation;
}

async function seedRealConversation(conversation, userContent, assistantContent) {
  const seeded = JSON.parse(await devtools.evaluate(`(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch("/api/openai/conversations/${conversation.id}/messages/fixture", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        "X-Engram-Browser-Fixture": "chat-archive-export",
      },
      body: JSON.stringify({
        userContent: ${JSON.stringify(userContent)},
        assistantContent: ${JSON.stringify(assistantContent)},
      }),
    });
    const body = await response.json();
    return JSON.stringify({ status: response.status, messages: body.messages });
  })()`));
  if (
    seeded.status !== 201 ||
    !Array.isArray(seeded.messages) ||
    !seeded.messages.some((message) => message.role === "user" && message.content === userContent) ||
    !seeded.messages.some((message) => message.role === "assistant" && message.content === assistantContent)
  ) {
    throw new Error(`Real Clerk transcript fixture failed (${seeded.status})`);
  }
}

async function readRealConversation(id, session) {
  const response = await realApi(`/api/openai/conversations/${id}`, session);
  return {
    response,
    body: response.ok ? await response.json() : null,
  };
}

async function assertRealUiRequest(method, path, label, minimumCount = 1) {
  const requests = await devtools.evaluate("window.__engramChatRequestAudit ?? []");
  const count = requests.filter(
    (request) =>
      request.method === method &&
      request.path === path &&
      request.status >= 200 &&
      request.status < 300,
  ).length;
  if (count < minimumCount) {
    throw new Error(`Real Clerk UI did not receive a successful API response for ${label}`);
  }
}

async function cleanupDisposableAccount(session) {
  const response = await realApi("/api/openai/browser-fixture/cleanup", session, {
    method: "POST",
    headers: { "X-Engram-Browser-Fixture": "chat-archive-export" },
  });
  if (!response.ok) {
    throw new Error(`Disposable account cleanup returned HTTP ${response.status}`);
  }
}

async function cleanupRealClerkAccount(session) {
  const cleanupProblems = [];

  // Try per-conversation deletion first, then use the owner-scoped cleanup to
  // remove bootstrap rows and any conversation created before an assertion.
  for (const conversation of realConversations) {
    try {
      await realApi(`/api/openai/conversations/${conversation.id}`, session, {
        method: "DELETE",
      });
    } catch {
      // The owner-scoped cleanup below is authoritative.
    }
  }
  try {
    await cleanupDisposableAccount(session);
  } catch {
    cleanupProblems.push("owner-scoped data cleanup");
  }

  const revoke = async (url) => {
    try {
      await fetch(url, { method: "POST", headers: session.clerkHeaders });
    } catch {
      // Deleting the user below also invalidates remaining Clerk sessions/tokens.
    }
  };
  if (session.signInTokenId) {
    await revoke(`https://api.clerk.com/v1/sign_in_tokens/${session.signInTokenId}/revoke`);
  }
  if (session.sessionId) {
    await revoke(`https://api.clerk.com/v1/sessions/${session.sessionId}/revoke`);
  }

  try {
    const response = await fetch(`https://api.clerk.com/v1/users/${session.userId}`, {
      method: "DELETE",
      headers: session.clerkHeaders,
    });
    if (!response.ok && response.status !== 404) cleanupProblems.push("Clerk user deletion");
  } catch {
    cleanupProblems.push("Clerk user deletion");
  }

  if (cleanupProblems.length > 0) {
    throw new Error("Real Clerk browser check could not fully clean up disposable data and identity");
  }
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
    exportConversation = await createRealConversation("Export Check");
    selectionConversation = await createRealConversation("Selection Check");
    deleteConversation = await createRealConversation("Delete Check");
    await seedRealConversation(exportConversation, realFixtureUserMessage, realFixtureAssistantMessage);
    await seedRealConversation(
      selectionConversation,
      realSelectionUserMessage,
      realSelectionAssistantMessage,
    );
    await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `(() => {
        const originalFetch = window.fetch.bind(window);
        window.__engramChatRequestAudit = [];
        window.fetch = async (input, init) => {
          const rawUrl = typeof input === "string" || input instanceof URL ? input.toString() : input.url;
          const requestUrl = new URL(rawUrl, window.location.href);
          const method = String(
            init?.method ?? (input instanceof Request ? input.method : "GET"),
          ).toUpperCase();
          const response = await originalFetch(input, init);
          if (requestUrl.pathname.startsWith("/api/openai/conversations")) {
            window.__engramChatRequestAudit.push({
              method,
              path: requestUrl.pathname,
              status: response.status,
            });
          }
          return response;
        };
      })();`,
    });
    await devtools.call("Page.navigate", { url: `${appUrl}/chat` });
  }
  const conversationTitle = realClerkMode ? exportConversation.title : "Browser Archive Room";
  await waitFor(
    `Boolean(document.body?.innerText.includes(${JSON.stringify(conversationTitle)}))`,
    "chat conversation list",
    15000,
  );
  const rowAction = (ariaLabel, title) =>
    `Array.from(document.querySelectorAll('[aria-label="${ariaLabel}"]')).find((node) => node.parentElement?.parentElement?.textContent?.includes(${JSON.stringify(title)}))`;

  if (!realClerkMode) {
    for (const title of ["Browser Archive Room", "Browser Selection Room", "Browser Delete Room", "Browser Failed Delete Room"]) {
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

  await click(rowAction("Delete conversation", "Browser Delete Room"), "delete inactive conversation");
  await waitFor(`!document.body?.innerText.includes("Browser Delete Room")`, "deleted conversation removed from list");
  if (!(await devtools.evaluate(`document.body.innerText.includes("Selection room hello")`))) {
    throw new Error("Deleting an inactive conversation opened or replaced the active conversation");
  }
  console.log("Chat conversation controls check: inactive row delete kept selection open");

    await click(rowAction("Delete conversation", "Browser Failed Delete Room"), "failed delete conversation");
    await waitFor(`Boolean(document.body?.innerText.includes("Could not delete conversation"))`, "delete failure toast");
    if (!(await devtools.evaluate(`document.body.innerText.includes("Browser Failed Delete Room") && document.body.innerText.includes("Selection room hello")`))) {
      throw new Error("Failed deletion changed the conversation list or active conversation");
    }
    console.log("Chat conversation controls check: failed delete showed a destructive toast and preserved state");

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
  } else {
    for (const conversation of realConversations) {
      await waitFor(
        `Boolean(document.body?.innerText.includes(${JSON.stringify(conversation.title)}))`,
        `${conversation.title} list row`,
        15000,
      );
    }

    await click(
      `Array.from(document.querySelectorAll('[role="button"],button')).find((node) => node.textContent.includes(${JSON.stringify(selectionConversation.title)}))`,
      "real conversation selection",
    );
    await waitFor(
      `Boolean(document.body?.innerText.includes(${JSON.stringify(realSelectionUserMessage)}))`,
      "selected real conversation transcript",
      15000,
    );
    if (!(await devtools.evaluate(`document.body.innerText.includes(${JSON.stringify(selectionConversation.title)})`))) {
      throw new Error("Selecting a real conversation did not show its active title");
    }
    await assertRealUiRequest(
      "GET",
      `/api/openai/conversations/${selectionConversation.id}`,
      "conversation selection",
    );
    const selectedState = await readRealConversation(selectionConversation.id, disposableClerk);
    if (
      selectedState.response.status !== 200 ||
      !selectedState.body?.messages?.some(
        (message) => message.role === "user" && message.content === realSelectionUserMessage,
      )
    ) {
      throw new Error("Authenticated API did not return the selected conversation transcript");
    }

    await click(
      rowAction("Delete conversation", deleteConversation.title),
      "delete inactive real conversation",
    );
    await waitFor(
      `!document.body?.innerText.includes(${JSON.stringify(deleteConversation.title)})`,
      "deleted real conversation removed from list",
    );
    await assertRealUiRequest(
      "DELETE",
      `/api/openai/conversations/${deleteConversation.id}`,
      "inactive conversation delete",
    );
    const deletedState = await realApi(
      `/api/openai/conversations/${deleteConversation.id}`,
      disposableClerk,
    );
    if (deletedState.status !== 404) {
      throw new Error(`Authenticated API returned ${deletedState.status} after inactive conversation delete`);
    }
    if (!(await devtools.evaluate(`document.body.innerText.includes(${JSON.stringify(realSelectionUserMessage)})`))) {
      throw new Error("Deleting an inactive real conversation changed the active transcript");
    }

    await click(
      rowAction("Archive conversation", exportConversation.title),
      "archive inactive real conversation",
    );
    await waitFor(
      `!document.body?.innerText.includes(${JSON.stringify(exportConversation.title)})`,
      "archived real conversation removed from active list",
    );
    await assertRealUiRequest(
      "PATCH",
      `/api/openai/conversations/${exportConversation.id}/archive`,
      "inactive conversation archive",
    );
    const archivedState = await readRealConversation(exportConversation.id, disposableClerk);
    if (archivedState.response.status !== 200 || !archivedState.body?.archivedAt) {
      throw new Error("Authenticated API did not confirm inactive conversation archive");
    }
    if (!(await devtools.evaluate(`document.body.innerText.includes(${JSON.stringify(realSelectionUserMessage)})`))) {
      throw new Error("Archiving an inactive real conversation changed the active transcript");
    }

    await click(`document.querySelector('[aria-label="Show archived conversations"]')`, "real archived conversation view");
    await waitFor(
      `Boolean(document.querySelector('[aria-label="Show active conversations"]'))`,
      "real archived conversation view",
    );
    await waitFor(
      `Boolean(document.body?.innerText.includes(${JSON.stringify(exportConversation.title)}))`,
      "archived real conversation row",
    );
    await click(
      rowAction("Restore conversation", exportConversation.title),
      "restore inactive real conversation",
    );
    await waitFor(
      `!document.body?.innerText.includes(${JSON.stringify(exportConversation.title)})`,
      "restored real conversation removed from archived list",
    );
    await assertRealUiRequest(
      "PATCH",
      `/api/openai/conversations/${exportConversation.id}/archive`,
      "inactive conversation restore",
      2,
    );
    const restoredState = await readRealConversation(exportConversation.id, disposableClerk);
    if (restoredState.response.status !== 200 || restoredState.body?.archivedAt) {
      throw new Error("Authenticated API did not confirm inactive conversation restore");
    }
    if (!(await devtools.evaluate(`document.body.innerText.includes(${JSON.stringify(realSelectionUserMessage)})`))) {
      throw new Error("Restoring an inactive real conversation changed the active transcript");
    }
    await click(`document.querySelector('[aria-label="Show active conversations"]')`, "real active conversation view");
    await waitFor(
      `Boolean(document.body?.innerText.includes(${JSON.stringify(exportConversation.title)}))`,
      "restored real active-list row",
    );
    console.log("Chat conversation controls check: real inactive-row selection/archive/restore/delete verified");
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
    ? [conversationTitle, realFixtureUserMessage, realFixtureAssistantMessage]
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

  await waitFor(
    `Boolean(${rowAction("Archive conversation", conversationTitle)})`,
    "archive control",
  );
  console.log("Chat archive/export check: archive state=active -> archived");
  await click(
    rowAction("Archive conversation", conversationTitle),
    "archive conversation",
  );
  await waitFor(`document.querySelector('textarea')?.disabled === true`, "archived read-only composer");
  if (!(await devtools.evaluate(`document.body.innerText.includes("restore it to send")`))) {
    throw new Error("Archived conversation did not show its read-only state");
  }
  if (realClerkMode) {
    const archivedSend = await realApi(
      `/api/openai/conversations/${exportConversation.id}/messages`,
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
  await click(
    rowAction("Restore conversation", conversationTitle),
    "restore conversation",
  );
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
  let cleanupError;
  if (realClerkMode && disposableClerk) {
    try {
      await cleanupRealClerkAccount(disposableClerk);
    } catch (error) {
      cleanupError = error;
      console.error(error instanceof Error ? error.message : "Disposable account cleanup failed");
    }
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
  if (cleanupError) throw cleanupError;
}