import { existsSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const appUrl = process.env.ENGRAM_BROWSER_TEST_URL ?? "http://127.0.0.1:5188";
const debugPort = Number(process.env.ENGRAM_BROWSER_DEBUG_PORT ?? 9234);
const profileDir = await mkdtemp(join(tmpdir(), "engram-download-profile-"));
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
  throw new Error(
    "Could not find Chromium. Set CHROMIUM_PATH or install chromium.",
  );
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
        if (!page?.webSocketDebuggerUrl)
          throw new Error("No Chromium page target");
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

const desktopMeta = {
  available: true,
  source: "github",
  version: "9.8.7",
  publishedAt: "2026-01-02T12:00:00.000Z",
  releaseNotesUrl: "https://github.com/acme/engram/releases/tag/v9.8.7",
  installers: [
    {
      os: "mac",
      ext: ".dmg",
      filename: "ENGRAM-9.8.7-arm64.dmg",
      sizeBytes: 110000000,
      downloadPath: "/api/download/desktop/ENGRAM-9.8.7-arm64.dmg",
    },
    {
      os: "win",
      ext: ".exe",
      filename: "ENGRAM-9.8.7-setup.exe",
      sizeBytes: 90000000,
      downloadPath: "/api/download/desktop/ENGRAM-9.8.7-setup.exe",
    },
    {
      os: "win",
      ext: ".zip",
      filename: "ENGRAM-9.8.7-win.zip",
      sizeBytes: 85000000,
      downloadPath: "/api/download/desktop/ENGRAM-9.8.7-win.zip",
    },
    {
      os: "linux",
      ext: ".AppImage",
      filename: "ENGRAM-9.8.7.AppImage",
      sizeBytes: 100000000,
      downloadPath: "/api/download/desktop/ENGRAM-9.8.7.AppImage",
    },
    {
      os: "linux",
      ext: ".deb",
      filename: "engram_9.8.7_amd64.deb",
      sizeBytes: 80000000,
      downloadPath: "/api/download/desktop/engram_9.8.7_amd64.deb",
    },
  ],
};

const androidMeta = {
  available: true,
  source: "github",
  version: "9.8.7",
  filename: "engram-9.8.7.apk",
  sizeBytes: 70000000,
  publishedAt: "2026-01-02T12:00:00.000Z",
  downloadPath: "/api/download/android.apk",
  releaseNotesUrl: "https://github.com/acme/engram/releases/tag/v9.8.7",
};

const fixtureScript = String.raw`
(() => {
  const originalFetch = window.fetch.bind(window);
  const failed = new URLSearchParams(window.location.search).has("failure");
  const response = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  const desktopMeta = ${JSON.stringify(desktopMeta)};
  const androidMeta = ${JSON.stringify(androidMeta)};
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    const pathname = new URL(url, window.location.origin).pathname;
    if (failed && (pathname === "/api/download/desktop" || pathname === "/api/download/android")) {
      return response({ error: "fixture unavailable" }, 503);
    }
    if (pathname === "/api/download/desktop") return response(desktopMeta);
    if (pathname === "/api/download/android") return response(androidMeta);
    return originalFetch(input, init);
  };
})();
`;

const devtools = new DevTools();

async function waitFor(expression, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await devtools.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForText(text, label, timeout = 10000) {
  await waitFor(
    `document.body?.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`,
    label,
    timeout,
  );
}

try {
  await devtools.connect();
  await devtools.call("Page.enable");
  await devtools.call("Runtime.enable");
  const encodedFixture = Buffer.from(fixtureScript).toString("base64");
  await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`,
  });

  await devtools.call("Page.navigate", { url: `${appUrl}/download` });
  await waitFor(
    "document.querySelectorAll('a[download]').length === 6",
    "all platform installer links",
  );
  await waitForText("Latest", "version badge");
  await waitForText("Published", "published date");

  const populated = await devtools.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll("a[download]")).map((node) => ({
      href: node.getAttribute("href"),
      download: node.getAttribute("download")
    }));
    const releaseLinks = Array.from(document.querySelectorAll('a[href^="https://github.com/"]'))
      .map((node) => node.getAttribute("href"));
    return {
      body: document.body.innerText,
      links,
      releaseLinks
    };
  })()`);

  if (!/latest\s*v9\.8\.7/i.test(populated.body)) {
    throw new Error(`Version badge was not rendered: ${populated.body}`);
  }
  if (!populated.body.includes("Published Jan 2, 2026")) {
    throw new Error(`Published date was not rendered: ${populated.body}`);
  }

  const expectedAssets = [
    "ENGRAM-9.8.7-arm64.dmg",
    "ENGRAM-9.8.7-setup.exe",
    "ENGRAM-9.8.7-win.zip",
    "ENGRAM-9.8.7.AppImage",
    "engram_9.8.7_amd64.deb",
    "engram-9.8.7.apk",
  ];
  for (const asset of expectedAssets) {
    const link = populated.links.find(
      (candidate) => candidate.download === asset,
    );
    const expectedHref = asset.endsWith(".apk")
      ? "/api/download/android.apk"
      : `/api/download/desktop/${asset}`;
    if (
      !link ||
      link.href !== expectedHref
    ) {
      throw new Error(
        `Installer target mismatch for ${asset}: ${JSON.stringify(link)}`,
      );
    }
  }
  if (
    populated.releaseLinks.length !== 1 ||
    populated.releaseLinks.some(
      (href) => href !== "https://github.com/acme/engram/releases/tag/v9.8.7",
    )
  ) {
    throw new Error(
      `API release-notes URL was not used: ${JSON.stringify(populated.releaseLinks)}`,
    );
  }

  await devtools.call("Page.navigate", { url: `${appUrl}/download?failure=1` });
  await waitForText(
    "Couldn't reach the download service",
    "download API error",
    12000,
  );
  const fallback = await devtools.evaluate(`Array.from(
    document.querySelectorAll('a[href^="https://github.com/"]')
  ).map((node) => node.getAttribute("href"))`);
  if (
    fallback.length < 2 ||
    fallback.some(
      (href) => href !== "https://github.com/Tech953/Ch-IO/releases/latest",
    )
  ) {
    throw new Error(
      `GitHub Releases fallback link was not usable: ${JSON.stringify(fallback)}`,
    );
  }

  console.log("Download metadata browser regression passed");
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