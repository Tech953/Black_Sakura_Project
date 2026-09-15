import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const chromiumPath = process.env.CHROMIUM_PATH ?? "/repl/tools/bin/chromium";
const settingsHtml = readFileSync(
  fileURLToPath(new URL("../src/settings.html", import.meta.url)),
  "utf8",
);

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") {
    throw new Error("could not reserve a local browser-test port");
  }
  return address.port;
}

async function serveSettings() {
  const port = await getFreePort();
  const server = createServer((request, response) => {
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/settings.html") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(settingsHtml),
    });
    response.end(settingsHtml);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${port}/settings.html`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

class DevTools {
  #socket;
  #nextId = 1;
  #pending = new Map();

  async connect(debugPort) {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        const targets = await response.json();
        const page = targets.find((target) => target.type === "page");
        if (!page?.webSocketDebuggerUrl) {
          throw new Error("no Chromium page target");
        }
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
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "browser evaluation failed";
      throw new Error(`${detail}\nExpression: ${expression.slice(0, 240)}`);
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

const fixtureScript = String.raw`
(() => {
  const activeSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const readySha = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const failedSha = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
  const calls = [];
  const prompts = [];
  const confirmations = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const makeModel = (sha256, displayName, filename, byteSize, status, compatibility, error) => ({
    storageLocation: "userData",
    status,
    compatibility,
    ...(error ? { error } : {}),
    metadata: {
      filename,
      displayName,
      byteSize,
      sha256,
      ggufVersion: 3,
      importedAt: "2026-01-01T00:00:00.000Z",
      lastUsedAt: status === "active"
        ? "2026-01-02T03:04:05.000Z"
        : "2026-01-03T03:04:05.000Z"
    }
  });
  const state = {
    mode: "custom",
    bundledAvailable: true,
    bundledModelIncluded: true,
    allowLan: false,
    lanAddresses: ["http://127.0.0.1:4312", "http://192.168.1.50:4312"],
    offline: { baseUrl: "http://127.0.0.1:11434/v1", model: "fixture" },
    online: { baseUrl: "https://example.invalid/v1", model: "fixture" },
    hasApiKey: false,
    encryptionAvailable: true,
    customModels: [
      makeModel(activeSha, "Aurora", "aurora.gguf", 2 * 1024 * 1024, "active", "compatible"),
      makeModel(readySha, "Borealis", "borealis.gguf", 1024 * 1024, "available", "compatible"),
      makeModel(
        failedSha,
        "Broken fixture",
        "broken.gguf",
        512 * 1024,
        "error",
        "incompatible",
        "Runtime compatibility check failed",
      )
    ],
    customStorageBytes: 3.5 * 1024 * 1024,
    customStorageLimitBytes: 10 * 1024 * 1024,
    offlineModel: {
      filename: "offline.gguf",
      expectedBytes: 0,
      expectedSha256: "",
      storageLocation: "userData",
      status: "none",
      downloadedBytes: 0
    }
  };
  state.customModel = state.customModels[0];
  const snapshot = () => ({
    ...clone(state),
    customModel: state.customModel ? clone(state.customModel) : null,
    customModels: clone(state.customModels)
  });
  const record = (method, ...args) => calls.push({ method, args });
  const listeners = { gguf: [], offline: [], updates: [] };

  window.__settingsFixture = {
    calls,
    prompts,
    confirmations,
    snapshot
  };
  window.confirm = (message) => {
    confirmations.push(message);
    return true;
  };
  window.prompt = (message, defaultValue) => {
    prompts.push({ message, defaultValue });
    return "Aurora renamed";
  };
  window.engram = {
    getSettings: async () => snapshot(),
    saveSettings: async (payload) => {
      record("saveSettings", payload);
      return { ok: true };
    },
    chooseGguf: async () => ({ ok: false, cancelled: true }),
    importGguf: async (selectionId) => {
      record("importGguf", selectionId);
      return { ok: false, error: "fixture does not import" };
    },
    cancelGgufImport: async (operationId) => {
      record("cancelGgufImport", operationId);
      return { ok: true };
    },
    activateGguf: async (sha256) => {
      record("activateGguf", sha256);
      const model = state.customModels.find((candidate) => candidate.metadata.sha256 === sha256);
      if (!model || model.compatibility !== "compatible" || model.status === "error") {
        return { ok: false, error: "Model compatibility check failed" };
      }
      for (const candidate of state.customModels) {
        if (candidate.compatibility === "compatible") candidate.status = "available";
      }
      model.status = "active";
      state.customModel = model;
      state.mode = "custom";
      return { ok: true };
    },
    renameGguf: async (sha256, displayName) => {
      record("renameGguf", sha256, displayName);
      const model = state.customModels.find((candidate) => candidate.metadata.sha256 === sha256);
      if (!model) return { ok: false, error: "Model not found" };
      model.metadata.displayName = displayName;
      return { ok: true };
    },
    removeGguf: async (sha256) => {
      record("removeGguf", sha256);
      const index = state.customModels.findIndex((candidate) => candidate.metadata.sha256 === sha256);
      if (index < 0) return { ok: false, error: "Model not found" };
      const [removed] = state.customModels.splice(index, 1);
      if (removed.status === "active") {
        const fallback = state.customModels.find((candidate) => candidate.compatibility === "compatible");
        if (!fallback) return { ok: false, error: "No safe fallback" };
        fallback.status = "available";
        state.customModel = fallback;
        state.mode = "bundled";
      }
      state.customStorageBytes -= removed.metadata.byteSize;
      return { ok: true };
    },
    onGgufImportStatus: (callback) => {
      listeners.gguf.push(callback);
      return () => {};
    },
    downloadOfflineModel: async () => ({ ok: false, error: "fixture does not download" }),
    cancelOfflineModelDownload: async () => ({ ok: true }),
    removeOfflineModel: async () => ({ ok: true }),
    onOfflineModelStatus: (callback) => {
      listeners.offline.push(callback);
      return () => {};
    },
    close: async () => record("close"),
    copyText: async (text) => {
      record("copyText", text);
      return { ok: true };
    },
    getUiLanguage: async () => "en",
    setUiLanguage: async (language) => record("setUiLanguage", language),
    getAppInfo: async () => ({
      version: "0.1.0",
      updatesSupported: false,
      updateStatus: { state: "idle" }
    }),
    checkForUpdates: async () => record("checkForUpdates"),
    installDownloadedUpdate: async () => ({ ok: false, error: "fixture does not update" }),
    openReleaseDownloadPage: async () => ({ ok: true }),
    onUpdateStatus: (callback) => {
      listeners.updates.push(callback);
      return () => {};
    }
  };
})();
`;

async function waitFor(devtools, expression, message, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await devtools.evaluate(expression)) return;
    await delay(50);
  }
  let diagnostic = "";
  try {
    diagnostic = JSON.stringify(
      await devtools.evaluate(`(() => ({
        readyState: document.readyState,
        title: document.title,
        bridgeType: typeof window.engram,
        bodyText: document.body?.innerText?.slice(0, 500),
        libraryHtml: document.querySelector("#custom-library")?.innerHTML?.slice(0, 500)
      }))()`),
    );
  } catch (error) {
    diagnostic = `diagnostic evaluation failed: ${error.message}`;
  }
  throw new Error(`${message} (${diagnostic})`);
}

async function main() {
  const debugPort = await getFreePort();
  const browserProfile = await mkdtemp(join(tmpdir(), "engram-settings-browser-"));
  const served = await serveSettings();
  const chromium = spawn(
    chromiumPath,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${browserProfile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let chromiumExited = false;
  chromium.once("exit", () => {
    chromiumExited = true;
  });
  const devtools = new DevTools();

  try {
    await devtools.connect(debugPort);
    await devtools.call("Page.enable");
    await devtools.call("Runtime.enable");
    const encodedFixture = Buffer.from(fixtureScript).toString("base64");
    await devtools.call("Page.addScriptToEvaluateOnNewDocument", {
      source: `window.eval(atob(${JSON.stringify(encodedFixture)}));`,
    });
    await devtools.call("Page.navigate", { url: served.url });
    await waitFor(
      devtools,
      `document.querySelectorAll("#custom-library .model-card").length === 3`,
      "Settings model library did not render all fixture cards",
    );

    const initial = await devtools.evaluate(`(() => {
      const cards = [...document.querySelectorAll("#custom-library .model-card")];
      return {
        storage: document.querySelector("#custom-storage")?.textContent,
        cards: cards.map((card) => card.textContent),
        failedActivationDisabled: document.querySelector(
          '[data-model-action="activate"][data-sha256="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]',
        )?.disabled === true,
      };
    })()`);
    if (
      initial.storage !== "3 managed models · 3.5 MB / 10 MB used" ||
      initial.cards.length !== 3 ||
      !initial.cards[0].includes("Aurora") ||
      !initial.cards[0].includes("2 MB") ||
      !initial.cards[0].includes("aaaaaaaaaaaaaaaa…") ||
      !initial.cards[0].includes("Compatible") ||
      !initial.cards[0].includes("Last used") ||
      !initial.cards[1].includes("Borealis") ||
      !initial.cards[1].includes("1 MB") ||
      !initial.cards[1].includes("bbbbbbbbbbbbbbbb…") ||
      !initial.cards[2].includes("Broken fixture") ||
      !initial.cards[2].includes("Incompatible") ||
      !initial.failedActivationDisabled
    ) {
      throw new Error(`unexpected initial model cards: ${JSON.stringify(initial)}`);
    }

    await devtools.evaluate(
      `document.querySelector('#lan-addresses button')?.click()`,
    );
    await waitFor(
      devtools,
      `window.__settingsFixture.calls.some((call) =>
        call.method === "copyText" && call.args[0] === "http://127.0.0.1:4312"
      )`,
      "Settings did not forward the local server address copy",
    );
    const copyFeedback = await devtools.evaluate(`({
      status: document.querySelector("#lan-copy-status")?.textContent,
      addresses: [...document.querySelectorAll(".lan-address-value")].map((node) => node.textContent)
    })`);
    if (
      !copyFeedback.status?.includes("Copied http://127.0.0.1:4312") ||
      JSON.stringify(copyFeedback.addresses) !==
        JSON.stringify(["http://127.0.0.1:4312", "http://192.168.1.50:4312"])
    ) {
      throw new Error(`local server copy feedback failed: ${JSON.stringify(copyFeedback)}`);
    }

    await devtools.evaluate(`document.querySelector(
      '[data-model-action="rename"][data-sha256="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]',
    ).click()`);
    await waitFor(
      devtools,
      `window.__settingsFixture.calls.some((call) => call.method === "renameGguf")`,
      "Settings did not forward the model rename",
    );
    const renamed = await devtools.evaluate(`(() => {
      const call = window.__settingsFixture.calls.find((entry) => entry.method === "renameGguf");
      return {
        call,
        visible: document.querySelector(".model-card .model-card-name")?.textContent
      };
    })()`);
    if (
      renamed.call?.args?.[0] !== "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ||
      renamed.call?.args?.[1] !== "Aurora renamed" ||
      renamed.visible !== "Aurora renamed"
    ) {
      throw new Error(`rename bridge/UI contract failed: ${JSON.stringify(renamed)}`);
    }

    await devtools.evaluate(`document.querySelector(
      '[data-model-action="activate"][data-sha256="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]',
    ).click()`);
    await waitFor(
      devtools,
      `window.__settingsFixture.calls.some((call) =>
        call.method === "activateGguf" &&
        call.args[0] === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      )`,
      "Settings did not forward model activation",
    );
    await waitFor(
      devtools,
      `document.querySelector('[data-model-action="remove"][data-sha256="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]') !== null`,
      "Settings did not rerender the switched active model",
    );

    const beforeFailedActivation = await devtools.evaluate(
      `window.__settingsFixture.calls.filter((call) => call.method === "activateGguf").length`,
    );
    await devtools.evaluate(`document.querySelector(
      '[data-model-action="activate"][data-sha256="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]',
    ).click()`);
    const afterFailedActivation = await devtools.evaluate(
      `window.__settingsFixture.calls.filter((call) => call.method === "activateGguf").length`,
    );
    if (afterFailedActivation !== beforeFailedActivation) {
      throw new Error("incompatible/failed model exposed an activatable UI action");
    }

    await devtools.evaluate(`document.querySelector(
      '[data-model-action="remove"][data-sha256="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]',
    ).click()`);
    await waitFor(
      devtools,
      `window.__settingsFixture.calls.some((call) =>
        call.method === "removeGguf" &&
        call.args[0] === "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      )`,
      "Settings did not forward active-model removal",
    );
    const finalState = await devtools.evaluate(`(() => ({
      snapshot: window.__settingsFixture.snapshot(),
      confirmation: window.__settingsFixture.confirmations.at(-1),
      cards: [...document.querySelectorAll("#custom-library .model-card")].map((card) => card.textContent),
      activateCalls: window.__settingsFixture.calls.filter((call) => call.method === "activateGguf"),
      renameCalls: window.__settingsFixture.calls.filter((call) => call.method === "renameGguf"),
      removeCalls: window.__settingsFixture.calls.filter((call) => call.method === "removeGguf")
    }))()`);
    if (
      finalState.snapshot.mode !== "bundled" ||
      finalState.snapshot.customModel?.metadata?.sha256 !==
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" ||
      finalState.snapshot.customModels.length !== 2 ||
      finalState.snapshot.customModels.some(
        (model) =>
          model.metadata?.sha256 ===
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ) ||
      !finalState.confirmation?.includes("safe fallback") ||
      finalState.activateCalls.length !== 1 ||
      finalState.renameCalls.length !== 1 ||
      finalState.removeCalls.length !== 1 ||
      finalState.cards.length !== 2
    ) {
      throw new Error(`model-library action contract failed: ${JSON.stringify(finalState)}`);
    }
    console.log(
      "[settings-browser] PASS: model cards, metadata, rename, activation, failed-model guard, and safe fallback removal",
    );
  } finally {
    devtools.close();
    chromium.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => {
        if (chromiumExited) {
          resolve();
          return;
        }
        chromium.once("exit", resolve);
      }),
      delay(2_000),
    ]);
    if (!chromiumExited) chromium.kill("SIGKILL");
    await served.close();
    await rm(browserProfile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[settings-browser] FAIL: ${error.message}`);
  process.exitCode = 1;
});