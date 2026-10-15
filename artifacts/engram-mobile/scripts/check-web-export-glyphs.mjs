#!/usr/bin/env node

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(mobileRoot, "../..");
const moduleRoots = [
  process.env.WEB_EXPORT_GLYPH_MODULE_ROOT,
  path.join(workspaceRoot, "artifacts", "desktop"),
  workspaceRoot,
].filter(Boolean);

const samples = [
  {
    family: "Engram Noto Devanagari",
    text: "नमस्ते दुनिया",
  },
  {
    family: "Engram Noto Hebrew",
    text: "שלום עולם",
  },
  {
    family: "Engram Noto Greek",
    text: "Γειά σου κόσμε",
  },
];

// These are Chromium canvas signatures for the checked-in font subsets and
// representative strings above. A changed signature requires reviewing the
// visible glyph output, not merely updating this fixture.
const expectedFixtures = {
  "Engram Noto Devanagari": {
    width: 328.03,
    inkPixels: 7031,
    bounds: { left: 24, top: 54, right: 353, bottom: 140 },
    hash: 3304532593,
  },
  "Engram Noto Hebrew": {
    width: 330.98,
    inkPixels: 5332,
    bounds: { left: 368, top: 65, right: 691, bottom: 122 },
    hash: 3492289211,
  },
  "Engram Noto Greek": {
    width: 502.56,
    inkPixels: 7846,
    bounds: { left: 31, top: 64, right: 524, bottom: 136 },
    hash: 211769002,
  },
};

function loadWorkspacePackage(packageName) {
  const failures = [];
  for (const root of moduleRoots) {
    try {
      const require = createRequire(path.join(root, "package.json"));
      return require(packageName);
    } catch (error) {
      failures.push(`${root}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(
    `Web export glyph check needs ${packageName}. Install it in a workspace package or set WEB_EXPORT_GLYPH_MODULE_ROOT.\n` +
      failures.join("\n"),
  );
}

function chromiumExecutable() {
  const configured = process.env.CHROMIUM_PATH;
  const candidates = [
    configured,
    "/repl/tools/bin/chromium",
    "chromium",
    "chromium-browser",
    "google-chrome",
  ].filter(Boolean);
  const executable = candidates
    .map((candidate) => {
      if (candidate.startsWith("/") && existsSync(candidate)) return candidate;
      const result = spawnSync("which", [candidate], { encoding: "utf8" });
      return result.status === 0 ? result.stdout.trim() : "";
    })
    .find(Boolean);
  if (!executable) {
    throw new Error("Could not find Chromium. Set CHROMIUM_PATH or install Chromium.");
  }
  return executable;
}

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a browser fixture port.");
  }
  return address.port;
}

async function serveBundle(bundlePath) {
  const port = await getFreePort();
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>ENGRAM Unicode glyph fixture</title></head>
    <body><main id="ready">Unicode glyph fixture</main>
    <script src="/glyph-fixture.js"></script></body></html>`;
  const server = createServer(async (request, response) => {
    if (request.url === "/glyph-fixture.js") {
      const bundle = await readFile(bundlePath);
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "content-length": bundle.byteLength,
      });
      response.end(bundle);
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    server,
    url: `http://127.0.0.1:${port}/`,
  };
}

function buildBrowserEntry() {
  return `
    import { ensureBrowserUnicodeFonts } from "./lib/web-chat-export.ts";

    const samples = ${JSON.stringify(samples)};

    function hashInk(pixels) {
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        const isInk =
          pixels[index] < 245 ||
          pixels[index + 1] < 245 ||
          pixels[index + 2] < 245;
        if (!isInk) continue;
        hash ^= pixels[index];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 1];
        hash = Math.imul(hash, 16777619);
        hash ^= pixels[index + 2];
        hash = Math.imul(hash, 16777619);
      }
      return hash >>> 0;
    }

    function inspectCanvas(canvas, context, text) {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      let inkPixels = 0;
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const isInk =
            image.data[offset] < 245 ||
            image.data[offset + 1] < 245 ||
            image.data[offset + 2] < 245;
          if (!isInk) continue;
          inkPixels += 1;
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      return {
        width: Math.round(context.measureText(text).width * 100) / 100,
        inkPixels,
        bounds: {
          left,
          top,
          right,
          bottom,
        },
        hash: hashInk(image.data),
      };
    }

    window.__engramGlyphRegression = {
      async run() {
        await ensureBrowserUnicodeFonts();
        await document.fonts.ready;
        return Object.fromEntries(samples.map(({ family, text }) => {
          const canvas = document.createElement("canvas");
          canvas.width = 720;
          canvas.height = 180;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Chromium did not create a 2D canvas context");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.font = '72px "' + family + '"';
          context.fillStyle = "#111827";
          const rtl = family === "Engram Noto Hebrew";
          context.direction = rtl ? "rtl" : "ltr";
          context.textAlign = rtl ? "right" : "left";
          context.textBaseline = "alphabetic";
          context.fillText(text, rtl ? canvas.width - 24 : 24, 120);
          return [
            family,
            {
              loaded: document.fonts.check('72px "' + family + '"', text),
              ...inspectCanvas(canvas, context, text),
            },
          ];
        }));
      },
    };
  `;
}

async function buildBrowserBundle(esbuild, outputDirectory) {
  const outfile = path.join(outputDirectory, "glyph-fixture.js");
  const expoFontStub = "\0expo-font-unicode-glyph";
  const expoFontNamespace = "expo-font-unicode-glyph";
  await esbuild.build({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile,
    stdin: {
      contents: buildBrowserEntry(),
      resolveDir: mobileRoot,
      sourcefile: "unicode-glyph-fixture-entry.ts",
      loader: "ts",
    },
    loader: { ".woff2": "dataurl" },
    plugins: [
      {
        name: "expo-font-browser-loader",
        setup(build) {
          build.onResolve({ filter: /^expo-font$/ }, () => ({
            path: expoFontStub,
            namespace: expoFontNamespace,
          }));
          build.onLoad(
            { filter: /^\0expo-font-unicode-glyph$/, namespace: expoFontNamespace },
            () => ({
              contents: `
                export const FontDisplay = { BLOCK: "block" };
                export async function loadAsync(fonts) {
                  await Promise.all(Object.entries(fonts).map(async ([family, config]) => {
                    try {
                      const face = new FontFace(family, "url(" + config.uri + ")", {
                        display: config.display,
                      });
                      document.fonts.add(await face.load());
                    } catch (error) {
                      throw new Error("Could not load bundled Unicode font " + family, {
                        cause: error,
                      });
                    }
                  }));
                }
              `,
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  return outfile;
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
        if (!page?.webSocketDebuggerUrl) throw new Error("No Chromium page target.");
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
            pending.reject(new Error(JSON.stringify(message.error)));
          } else {
            pending.resolve(message.result);
          }
        });
        return;
      } catch {
        await delay(100);
      }
    }
    throw new Error("Chromium remote debugging did not start.");
  }

  call(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
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
      const detail =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "Browser evaluation failed.";
      throw new Error(detail);
    }
    return result.result?.value;
  }

  close() {
    this.#socket?.close();
  }
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(1_000)]);
  }
}

async function main() {
  const esbuild = loadWorkspacePackage("esbuild");
  const debugPort = await getFreePort();
  const profileDirectory = await mkdtemp(
    path.join(os.tmpdir(), "engram-glyph-profile-"),
  );
  const chromium = spawn(
    chromiumExecutable(),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "engram-unicode-glyph-"),
  );
  const devtools = new DevTools();
  let fixture;
  try {
    const bundlePath = await buildBrowserBundle(esbuild, outputDirectory);
    fixture = await serveBundle(bundlePath);
    await devtools.connect(debugPort);
    await devtools.call("Runtime.enable");
    await devtools.call("Page.navigate", { url: fixture.url });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await devtools.evaluate("Boolean(window.__engramGlyphRegression)")) break;
      await delay(100);
    }
    const results = await devtools.evaluate(
      "window.__engramGlyphRegression.run()",
    );
    if (process.env.UPDATE_WEB_EXPORT_GLYPH_FIXTURES === "true") {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    for (const sample of samples) {
      const actual = results[sample.family];
      const expected = expectedFixtures[sample.family];
      if (!actual?.loaded) {
        throw new Error(
          `Unicode glyph fixture did not load font family "${sample.family}".`,
        );
      }
      if (actual.inkPixels <= 0) {
        throw new Error(
          `Unicode glyph fixture rendered no visible pixels for font family "${sample.family}".`,
        );
      }
      if (JSON.stringify(actual) !== JSON.stringify({ loaded: true, ...expected })) {
        throw new Error(
          `Unicode glyph fixture changed for font family "${sample.family}": expected ${JSON.stringify(
            { loaded: true, ...expected },
          )}; received ${JSON.stringify(actual)}.`,
        );
      }
    }
    console.log(
      `Validated Chromium glyph fixtures for ${samples.map(({ family }) => family).join(", ")}.`,
    );
  } finally {
    devtools.close();
    if (fixture) {
      await new Promise((resolve) => fixture.server.close(resolve));
    }
    await stopProcess(chromium);
    await rm(outputDirectory, { recursive: true, force: true });
    await rm(profileDirectory, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  }
}

main().catch((error) => {
  console.error(
    `Web export glyph check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});