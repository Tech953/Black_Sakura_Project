import { mkdtemp } from "node:fs/promises";
import { rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5191";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9233);
const profileDir = await mkdtemp(join(tmpdir(), "engram-terminal-digest-profile-"));

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
  localStorage.setItem("engram.uiLang", "en");
  const originalFetch = window.fetch.bind(window);
  const groupId = "2026-09-13T12:03:00.000Z";
  const createdAt = "2026-09-13T12:03:00.000Z";
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const engrams = [{
    id: 901,
    slug: "digest-keeper",
    name: "Digest Keeper",
    title: "Browser digest fixture",
    symbol: "◇",
    origin: "Browser regression fixture",
    voiceProfile: {
      speechStyle: "clear",
      formatting: "plain",
      vocabulary: ["signal"],
      sampleLines: ["A fixture line."],
      narrationStyle: "first-person"
    },
    emotionalBaseline: { valence: 0.1, arousal: 0.2, volatility: 0.1, mood: "steady" },
    environmentAnchor: {
      name: "Fixture Environment",
      description: "An isolated browser test.",
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
    drives: [],
    focusThemes: ["digest"],
    autonomyEnabled: true,
    tickCadenceSeconds: 60,
    initiationThreshold: 0.8,
    driveState: {},
    currentMood: "steady",
    lastTickAt: createdAt,
    lastTransmissionAt: null,
    backoffUntil: null,
    isChatActive: true,
    mode: "social",
    humanContactEnabled: true,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    isArchival: false,
    createdAt,
    updatedAt: createdAt
  }];
  const makeMessage = (id, timestamp, content, isDigest = false) => ({
    id,
    fromEngramId: 901,
    toEngramId: null,
    spaceId: null,
    channel: "human",
    author: "engram",
    priority: "social",
    status: "digest",
    content,
    reason: isDigest ? "Bundled from unseen social-priority contact" : null,
    seen: true,
    isDigest,
    digestGroupId: groupId,
    deliveredAt: timestamp,
    acknowledgedAt: null,
    createdAt: timestamp
  });
  const messages = [
    makeMessage(
      900,
      createdAt,
      "Periodic digest · 2 low-priority messages\n• Digest Keeper: First source\n• Digest Keeper: Second source",
      true
    ),
    makeMessage(901, "2026-09-13T12:01:00.000Z", "Original source: first contact"),
    makeMessage(902, "2026-09-13T12:02:00.000Z", "Original source: second contact")
  ];
  const requests = [];
  const replyRequests = [];
  const unexpectedRequests = [];

  window.__terminalDigestFixture = {
    requests,
    replyRequests,
    unexpectedRequests
  };
  window.EventSource = class {
    addEventListener() {}
    close() {}
  };

  window.fetch = async (input, init = {}) => {
    const rawUrl = typeof input === "string" ? input : input.url;
    const url = new URL(rawUrl, window.location.origin);
    const method = String(
      init.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (url.origin !== window.location.origin) return originalFetch(input, init);

    if (url.pathname.startsWith("/api/")) {
      requests.push({ pathname: url.pathname, search: url.search, method });
    }
    if (url.pathname === "/api/engrams" && method === "GET") {
      return response(engrams);
    }
    if (url.pathname === "/api/hub/controls" && method === "GET") {
      return response({ id: 1, paused: false, quietMode: false, updatedAt: createdAt });
    }
    if (url.pathname === "/api/hub/spaces" && method === "GET") {
      return response([]);
    }
    if (url.pathname === "/api/messages" && method === "GET") {
      if (url.searchParams.get("channel") !== "human") {
        unexpectedRequests.push({ pathname: url.pathname, search: url.search, method });
        return response({ error: "Expected the terminal human-message query." }, 400);
      }
      return response(messages);
    }
    const replyMatch = url.pathname.match(/^\/api\/messages\/(\d+)\/reply$/);
    if (replyMatch && method === "POST") {
      const bodyText = init.body ?? (input instanceof Request ? await input.clone().text() : "{}");
      const reply = JSON.parse(bodyText || "{}");
      const sourceId = Number(replyMatch[1]);
      const source = messages.find((message) => message.id === sourceId);
      if (!source || source.isDigest || !reply.content) {
        unexpectedRequests.push({ pathname: url.pathname, search: url.search, method });
        return response({ error: "Invalid source reply fixture request." }, 400);
      }
      replyRequests.push({ id: sourceId, content: reply.content });
      const replyAt = "2026-09-13T12:04:00.000Z";
      const savedReply = {
        id: 903,
        fromEngramId: source.fromEngramId,
        toEngramId: source.fromEngramId,
        spaceId: null,
        channel: "human",
        author: "operator",
        priority: "social",
        status: "delivered",
        content: reply.content,
        reason: null,
        seen: true,
        isDigest: false,
        digestGroupId: null,
        deliveredAt: replyAt,
        acknowledgedAt: null,
        createdAt: replyAt
      };
      messages.push(savedReply);
      return response(savedReply, 201);
    }
    if (url.pathname === "/api/events" && method === "GET") {
      return response({});
    }
    if (url.pathname.startsWith("/api/")) {
      unexpectedRequests.push({ pathname: url.pathname, search: url.search, method });
      return response({ error: "No fixture for this API request." }, 501);
    }
    return originalFetch(input, init);
  };
})();
`;

async function waitFor(expression, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await devtools.evaluate(expression)) return;
    await delay(100);
  }
  const diagnostics = await devtools.evaluate(`({
    url: window.location.href,
    title: document.title,
    bodyTail: document.body?.innerText.slice(-900),
    rows: Array.from(document.querySelectorAll('[data-testid^="human-message-"]'))
      .map((row) => row.getAttribute("data-testid")),
    requests: window.__terminalDigestFixture?.requests,
    unexpectedRequests: window.__terminalDigestFixture?.unexpectedRequests
  })`);
  throw new Error(`Timed out waiting for ${label}. Browser state: ${JSON.stringify(diagnostics)}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function click(selector, label) {
  const clicked = await devtools.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Could not click ${label}`);
}

async function inspectTerminal() {
  return devtools.evaluate(`(() => {
    const summary = document.querySelector('[data-testid="human-message-900"]');
    const sourceContainer = document.querySelector('[data-testid="digest-sources-900"]');
    const toggle = document.querySelector('[data-testid="button-digest-sources-900"]');
    const allRows = Array.from(document.querySelectorAll('[data-testid^="human-message-"]'));
    const topLevelIds = allRows
      .filter((row) => !row.closest('[data-testid^="digest-sources-"]'))
      .map((row) => row.getAttribute("data-testid"))
      .sort();
    const sourceIds = sourceContainer
      ? Array.from(sourceContainer.querySelectorAll('[data-testid^="human-message-"]'))
          .map((row) => row.getAttribute("data-testid"))
          .sort()
      : [];
    const badgeTexts = (id) => {
      const row = document.querySelector('[data-testid="human-message-' + id + '"]');
      const header = row?.querySelector(":scope > div > div > div.flex.items-center.gap-2");
      return header
        ? Array.from(header.querySelectorAll(".inline-flex.items-center.rounded-md.border"))
            .map((badge) => badge.textContent.trim())
        : [];
    };
    return {
      pathname: window.location.pathname,
      browserTestAuthReady: typeof window.__engramBrowserTest?.switchAccount === "function",
      summaryExists: Boolean(summary),
      expanded: toggle?.getAttribute("aria-expanded") ?? null,
      allIds: allRows.map((row) => row.getAttribute("data-testid")).sort(),
      topLevelIds,
      sourceIds,
      summaryBadges: badgeTexts(900),
      firstSourceBadges: badgeTexts(901),
      secondSourceBadges: badgeTexts(902),
      summaryHasReply: Boolean(
        document.querySelector('[data-testid="textarea-reply-900"]') ||
        document.querySelector('[data-testid="button-reply-900"]')
      ),
      firstSourceHasReply: Boolean(
        document.querySelector('[data-testid="textarea-reply-901"]') &&
        document.querySelector('[data-testid="button-reply-901"]')
      ),
      firstSourceReplyDraft:
        document.querySelector('[data-testid="textarea-reply-901"]')?.value ?? null,
      replyText: document.querySelector('[data-testid="human-message-903"]')?.innerText ?? null,
      replyBadges: badgeTexts(903)
    };
  })()`);
}

async function fillTextarea(selector, value, label) {
  const filled = await devtools.evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (setter) setter.call(node, ${JSON.stringify(value)});
    else node.value = ${JSON.stringify(value)};
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error(`Could not fill ${label}`);
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  const encodedFixture = Buffer.from(fixtureScript).toString("base64");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`
  });
  await devtools.call("Page.navigate", { url: `${appUrl}/terminal` });

  await waitFor(
    `Boolean(document.querySelector('[data-testid="human-message-900"]'))`,
    "signed-in terminal digest summary"
  );
  const initial = await inspectTerminal();
  assert(initial.pathname === "/terminal", `Expected /terminal, got ${initial.pathname}`);
  assert(initial.browserTestAuthReady, "The guarded signed-in browser-test state did not initialize.");
  assert(initial.expanded === "false", `Digest sources should start collapsed: ${initial.expanded}`);
  assert(
    JSON.stringify(initial.allIds) === JSON.stringify(["human-message-900"]),
    `Source messages appeared as separate default cards: ${JSON.stringify(initial.allIds)}`
  );
  assert(
    JSON.stringify(initial.topLevelIds) === JSON.stringify(["human-message-900"]),
    `Expected only the digest summary at the top level: ${JSON.stringify(initial.topLevelIds)}`
  );
  assert(
    JSON.stringify(initial.summaryBadges) === JSON.stringify(["Social", "Digest", "Periodic Digest"]),
    `Unexpected digest summary badges: ${JSON.stringify(initial.summaryBadges)}`
  );
  assert(!initial.summaryHasReply, "A digest summary should not gain a reply form.");
  assert(
    JSON.stringify(await devtools.evaluate("window.__terminalDigestFixture.unexpectedRequests")) === "[]",
    "The terminal made an API request that the digest fixture did not provide."
  );

  await click('[data-testid="button-digest-sources-900"]', "expand digest source messages");
  await waitFor(
    `document.querySelector('[data-testid="button-digest-sources-900"]')?.getAttribute("aria-expanded") === "true" &&
      document.querySelectorAll('[data-testid="digest-sources-900"] [data-testid^="human-message-"]').length === 2`,
    "expanded digest source audit rows"
  );
  const expanded = await inspectTerminal();
  assert(
    JSON.stringify(expanded.sourceIds) ===
      JSON.stringify(["human-message-901", "human-message-902"]),
    `Expected both source rows inside the digest: ${JSON.stringify(expanded.sourceIds)}`
  );
  assert(
    JSON.stringify(expanded.topLevelIds) === JSON.stringify(["human-message-900"]),
    `Expanded source rows escaped the summary card: ${JSON.stringify(expanded.topLevelIds)}`
  );
  assert(
    JSON.stringify(expanded.summaryBadges) === JSON.stringify(initial.summaryBadges),
    `Expanding the digest changed its existing priority/status badges: ${JSON.stringify({
      before: initial.summaryBadges,
      after: expanded.summaryBadges
    })}`
  );
  assert(
    JSON.stringify(expanded.firstSourceBadges) === JSON.stringify(["Social", "Digest"]) &&
      JSON.stringify(expanded.secondSourceBadges) === JSON.stringify(["Social", "Digest"]),
    `Source priority/status badges were not preserved: ${JSON.stringify({
      first: expanded.firstSourceBadges,
      second: expanded.secondSourceBadges
    })}`
  );
  assert(expanded.firstSourceHasReply, "Expanded source rows should keep their reply controls.");
  assert(!expanded.summaryHasReply, "Expanding source rows added a reply form to the digest summary.");

  const replyContent = "I heard both notes.";
  await fillTextarea(
    '[data-testid="textarea-reply-901"]',
    replyContent,
    "first source reply"
  );
  await waitFor(
    `document.querySelector('[data-testid="button-reply-901"]')?.disabled === false`,
    "enabled source reply action"
  );
  await click('[data-testid="button-reply-901"]', "reply to the first source message");
  await waitFor(
    `window.__terminalDigestFixture.replyRequests.length === 1 &&
      Boolean(document.querySelector('[data-testid="human-message-903"]')) &&
      document.querySelector('[data-testid="textarea-reply-901"]')?.value === ""`,
    "saved reply to an expanded source message"
  );
  const replyRequest = await devtools.evaluate("window.__terminalDigestFixture.replyRequests[0]");
  const afterReply = await inspectTerminal();
  assert(
    replyRequest.id === 901 && replyRequest.content === replyContent,
    `The source reply used the wrong message or content: ${JSON.stringify(replyRequest)}`
  );
  assert(
    afterReply.replyText?.includes(replyContent) && afterReply.replyBadges.includes("Delivered"),
    `The saved reply did not retain normal delivered-message behavior: ${JSON.stringify({
      text: afterReply.replyText,
      badges: afterReply.replyBadges
    })}`
  );
  assert(
    JSON.stringify(afterReply.summaryBadges) === JSON.stringify(initial.summaryBadges),
    "Replying to a source message changed the digest summary badges."
  );

  await click('[data-testid="button-digest-sources-900"]', "collapse digest source messages");
  await waitFor(
    `document.querySelector('[data-testid="button-digest-sources-900"]')?.getAttribute("aria-expanded") === "false" &&
      !document.querySelector('[data-testid="human-message-901"]') &&
      !document.querySelector('[data-testid="human-message-902"]')`,
    "collapsed source audit rows"
  );
  const collapsedAgain = await inspectTerminal();
  assert(
    JSON.stringify(collapsedAgain.topLevelIds) ===
      JSON.stringify(["human-message-900", "human-message-903"]),
    `Collapsing changed the digest or saved reply cards: ${JSON.stringify(collapsedAgain.topLevelIds)}`
  );
  assert(
    JSON.stringify(collapsedAgain.summaryBadges) === JSON.stringify(initial.summaryBadges),
    "Collapsing the digest changed its existing priority/status badges."
  );
  assert(
    JSON.stringify(await devtools.evaluate("window.__terminalDigestFixture.unexpectedRequests")) === "[]",
    `Unexpected API requests occurred: ${JSON.stringify(
      await devtools.evaluate("window.__terminalDigestFixture.unexpectedRequests")
    )}`
  );

  await click('[data-testid="button-digest-sources-900"]', "reopen digest source messages");
  await waitFor(
    `document.querySelector('[data-testid="digest-sources-900"]')?.querySelectorAll('[data-testid^="human-message-"]').length === 2`,
    "reopened source audit rows"
  );
  const reopened = await inspectTerminal();
  assert(
    JSON.stringify(reopened.firstSourceBadges) === JSON.stringify(expanded.firstSourceBadges) &&
      JSON.stringify(reopened.secondSourceBadges) === JSON.stringify(expanded.secondSourceBadges),
    "Collapsing and reopening changed the source priority/status badges."
  );
  assert(
    reopened.firstSourceHasReply && reopened.firstSourceReplyDraft === "",
    "The source reply control did not remain usable after reopening."
  );

  console.log("Signed-in terminal digest-source browser regression passed");
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
