#!/usr/bin/env node

import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const mobileRoot = path.resolve(new URL("..", import.meta.url).pathname);
const workspaceRoot = path.resolve(mobileRoot, "../..");
const desktopRoot = path.join(workspaceRoot, "artifacts", "desktop");
const moduleRoots = [
  process.env.WEB_EXPORT_NATIVE_MODULE_ROOT,
  desktopRoot,
  workspaceRoot,
].filter(Boolean);

const formats = [
  ["md", "Signal-01.md", "text/markdown", [35, 32]],
  ["txt", "Signal-01.txt", "text/plain", [83, 105]],
  ["pdf", "Signal-01.pdf", "application/pdf", [37, 80, 68, 70]],
  [
    "docx",
    "Signal-01.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    [80, 75, 3, 4],
  ],
];

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
    `Native web export runner needs ${packageName}. ` +
      `Install it in a workspace package or set WEB_EXPORT_NATIVE_MODULE_ROOT.\n` +
      failures.join("\n"),
  );
}

function runnerExecutable(engine, browserType) {
  const variable =
    engine === "safari"
      ? "WEB_EXPORT_WEBKIT_EXECUTABLE_PATH"
      : "WEB_EXPORT_FIREFOX_EXECUTABLE_PATH";
  const configured = process.env[variable];
  const executable = configured || browserType.executablePath();
  if (!existsSync(executable)) {
    throw new Error(
      `Native ${engine === "safari" ? "Safari/WebKit" : "Firefox"} runner unavailable: ` +
        `${executable} does not exist. Set ${variable} to a browser executable ` +
        "or install the matching Playwright browser before running this check.",
    );
  }
  return executable;
}

function buildBrowserEntry() {
  return `
    import { buildWebChatExport, downloadWebChatExport } from "./lib/web-chat-export.ts";

    const transcript = {
      title: "Signal <01>",
      downloadedOn: "Exported on",
      exportedAt: "2026-09-10T00:01:00.000Z",
      conversationCreated: "Conversation created",
      createdAt: "2026-09-09T00:00:00.000Z",
      entries: [{
        heading: "You",
        timestamp: "2026-09-10T00:01:00.000Z",
        content: "Hello native browser compatibility",
      }],
    };

    window.__engramNativeWebExport = {
      async run(format) {
        const exported = await buildWebChatExport(format, transcript, "Signal-01");
        downloadWebChatExport(exported);
        return {
          filename: exported.filename,
          mimeType: exported.mimeType,
        };
      },
    };
  `;
}

async function buildBrowserBundle(esbuild, outputDirectory) {
  const outfile = path.join(outputDirectory, "native-web-export.js");
  const expoFontStub = "\0expo-font-native-browser";
  const expoFontNamespace = "expo-font-browser";
  await esbuild.build({
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    outfile,
    stdin: {
      contents: buildBrowserEntry(),
      resolveDir: mobileRoot,
      sourcefile: "native-web-export-entry.ts",
      loader: "ts",
    },
    loader: { ".woff2": "dataurl" },
    plugins: [
      {
        name: "expo-font-browser-stub",
        setup(build) {
          build.onResolve({ filter: /^expo-font$/ }, () => ({
            path: expoFontStub,
            namespace: expoFontNamespace,
          }));
          build.onLoad(
            { filter: /^\0expo-font-native-browser$/, namespace: expoFontNamespace },
            () => ({
              contents:
                "export const FontDisplay = { BLOCK: 'block' }; export async function loadAsync() {}",
              loader: "js",
            }),
          );
        },
      },
    ],
  });
  return outfile;
}

function startFixtureServer(bundlePath) {
  const html = `<!doctype html>
    <html><head><meta charset="utf-8"><title>Native export compatibility</title></head>
    <body><main id="ready">Native export compatibility fixture</main>
    <script src="/native-web-export.js"></script></body></html>`;
  const server = createServer(async (request, response) => {
    if (request.url === "/native-web-export.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(await readFile(bundlePath));
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
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Native web export fixture did not expose a TCP port"));
        return;
      }
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
      });
    });
  });
}

async function runEngine(engine, browserType, executable, fixtureUrl) {
  const browser = await browserType.launch({
    executablePath: executable,
    headless: true,
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    try {
      const page = await context.newPage();
      await page.goto(fixtureUrl, { waitUntil: "load" });
      await page.waitForFunction(
        () => Boolean(window.__engramNativeWebExport),
      );

      const results = [];
      for (const [format, filename, mimeType, prefix] of formats) {
        const downloadPromise = page.waitForEvent("download");
        const metadata = await page.evaluate(
          (selectedFormat) => window.__engramNativeWebExport.run(selectedFormat),
          format,
        );
        const download = await downloadPromise;
        const downloadPath = await download.path();
        if (!downloadPath) {
          throw new Error(`${engine} ${format} did not expose a downloaded file`);
        }
        const bytes = await readFile(downloadPath);
        if (
          metadata.filename !== filename ||
          metadata.mimeType !== mimeType ||
          download.suggestedFilename() !== filename ||
          bytes.length === 0 ||
          prefix.some((byte, index) => bytes[index] !== byte)
        ) {
          throw new Error(
            `Unexpected ${engine} ${format} download: ${JSON.stringify({
              metadata,
              suggestedFilename: download.suggestedFilename(),
              size: bytes.length,
              prefix: Array.from(bytes.subarray(0, 4)),
            })}`,
          );
        }
        results.push({
          format,
          filename,
          mimeType,
          size: bytes.length,
          prefix: Array.from(bytes.subarray(0, 4)),
        });
      }
      return { engine, executable, status: "passed", formats: results };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  const playwright = loadWorkspacePackage("playwright-core");
  const esbuild = loadWorkspacePackage("esbuild");
  const runners = [
    {
      engine: "safari",
      browserType: playwright.webkit,
    },
    {
      engine: "firefox",
      browserType: playwright.firefox,
    },
  ].map((runner) => ({
    ...runner,
    executable: runnerExecutable(runner.engine, runner.browserType),
  }));

  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "engram-native-web-export-"),
  );
  let fixture;
  try {
    const bundlePath = await buildBrowserBundle(esbuild, outputDirectory);
    fixture = await startFixtureServer(bundlePath);
    const results = [];
    for (const runner of runners) {
      results.push(
        await runEngine(
          runner.engine,
          runner.browserType,
          runner.executable,
          fixture.url,
        ),
      );
    }
    console.log(JSON.stringify({ nativeWebExportCoverage: results }, null, 2));
  } finally {
    fixture?.server.close();
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(
    `Native web export compatibility check failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});