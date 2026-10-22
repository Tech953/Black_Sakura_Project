import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9238);
const profileDir = await mkdtemp(join(tmpdir(), "engram-settings-profile-"));
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
            pending.reject(
              new Error(`${pending.method}: ${JSON.stringify(message.error)}`),
            );
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
    const result = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.text ?? "Browser evaluation failed",
      );
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

const fixtureScript = String.raw`
(() => {
  const originalFetch = window.fetch.bind(window);
  const requests = [];
  const healthRequests = [];
  let serverMode = "reachable";
  window.localStorage.removeItem("engram.localServerUrl");
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  window.__settingsBrowserFixture = {
    requests,
    healthRequests,
    setServerMode(mode) {
      serverMode = mode;
    }
  };
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const method = String(
      init.method ?? (typeof input === "string" ? "GET" : input.method ?? "GET")
    ).toUpperCase();
    const parsed = new URL(url, window.location.origin);
    requests.push({
      url: parsed.toString(),
      pathname: parsed.pathname,
      method,
      credentials: init.credentials ?? null
    });
    if (parsed.pathname === "/api/healthz" && method === "GET") {
      healthRequests.push({
        url: parsed.toString(),
        pathname: parsed.pathname,
        method,
        credentials: init.credentials ?? null
      });
      return serverMode === "reachable"
        ? response({ status: "ok" })
        : response({ status: "unavailable" }, 503);
    }
    if (parsed.pathname === "/api/events") return response({});
    return originalFetch(input, init);
  };
})();
`;

const devtools = new DevTools();

async function waitFor(expression, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await devtools.evaluate(expression)) return;
    await delay(100);
  }
  const diagnostic = await devtools.evaluate(`({
    body: document.body?.innerText?.slice(0, 1000),
    status: document.querySelector('[data-testid="local-server-status"]')?.innerText,
    requests: window.__settingsBrowserFixture?.requests
  })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
}

async function fillInput(value) {
  const filled = await devtools.evaluate(`(() => {
    const node = document.querySelector('[data-testid="input-local-server-url"]');
    if (!node) return false;
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!filled) throw new Error("Could not fill local server address");
}

async function clickCheck() {
  const clicked = await devtools.evaluate(`(() => {
    const node = document.querySelector('[data-testid="button-check-local-server"]');
    if (!node || node.disabled) return false;
    node.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error("Could not click local server check");
}

async function main() {
  try {
    await devtools.connect();
    await devtools.call("Page.enable");
    await devtools.call("Runtime.enable");
    const encodedFixture = Buffer.from(fixtureScript).toString("base64");
    await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`,
    });
    await devtools.call("Page.navigate", { url: `${appUrl}/settings` });

    await waitFor(
      `document.querySelector('[data-testid="section-local-server"]') !== null`,
      "Settings local-server card",
    );
    await waitFor(
      `document.querySelector('[data-testid="local-server-status"] strong')?.textContent === "Not configured"`,
      "not-configured state",
    );

    await fillInput("http://127.0.0.1:5444/");
    await clickCheck();
    await waitFor(
      `document.querySelector('[data-testid="local-server-status"] strong')?.textContent === "Reachable"`,
      "reachable state",
    );
    const reachable = await devtools.evaluate(`(() => {
      const request = window.__settingsBrowserFixture.requests.find(
        (entry) => entry.pathname === "/api/healthz",
      );
      return {
        input: document.querySelector('[data-testid="input-local-server-url"]')?.value,
        request
      };
    })()`);
    if (
      reachable.input !== "http://127.0.0.1:5444" ||
      reachable.request?.url !== "http://127.0.0.1:5444/api/healthz" ||
      reachable.request?.credentials !== "omit"
    ) {
      throw new Error(`Unexpected reachable-server probe: ${JSON.stringify(reachable)}`);
    }

    await devtools.evaluate("window.__settingsBrowserFixture.setServerMode('unavailable')");
    await fillInput("http://127.0.0.1:5445");
    await clickCheck();
    await waitFor(
      `document.querySelector('[data-testid="local-server-status"] strong')?.textContent === "Unavailable"`,
      "unavailable state",
    );

    const beforeInvalid = await devtools.evaluate(
      "window.__settingsBrowserFixture.healthRequests.length",
    );
    await fillInput(
      "http://operator:secret@127.0.0.1:5446/api/healthz?token=do-not-send#fragment",
    );
    await clickCheck();
    await waitFor(
      `document.querySelector('[data-testid="local-server-status"] strong')?.textContent === "Unavailable" &&
       document.querySelector('[data-testid="local-server-status"]')?.innerText.includes("Use an http://")`,
      "invalid URL state",
    );
    const invalid = await devtools.evaluate(`(() => {
      const requests = window.__settingsBrowserFixture.requests;
      const healthRequests = window.__settingsBrowserFixture.healthRequests;
      const status = document.querySelector('[data-testid="local-server-status"]')?.innerText || "";
      return {
        requestCount: healthRequests.length,
        newRequests: healthRequests.slice(${beforeInvalid}),
        status,
        leakedSecret: requests.some((entry) => entry.url.includes("secret") || entry.url.includes("do-not-send"))
      };
    })()`);
    if (
      invalid.requestCount !== beforeInvalid ||
      invalid.newRequests.length !== 0 ||
      invalid.leakedSecret ||
      invalid.status.includes("secret") ||
      invalid.status.includes("do-not-send")
    ) {
      throw new Error(`Invalid URL was not safely rejected: ${JSON.stringify(invalid)}`);
    }

    console.log(
      "[settings-browser] PASS: not-configured, reachable, unavailable, and safe invalid URL states",
    );
  } finally {
    devtools.close();
    let chromeExited = false;
    chrome.once("exit", () => {
      chromeExited = true;
    });
    chrome.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => {
        if (chromeExited) {
          resolve();
          return;
        }
        chrome.once("exit", resolve);
      }),
      delay(2_000),
    ]);
    if (!chromeExited) chrome.kill("SIGKILL");
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[settings-browser] FAIL: ${error.message}`);
  process.exitCode = 1;
});