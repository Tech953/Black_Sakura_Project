// Post-package smoke test: confirm the *installed* desktop app actually launches,
// not just that an installer was produced.
//
// The desktop CI pipeline proves an installer can be built on each OS, but a
// green build can still ship a binary that crashes on first run — most notably
// the documented electron-builder gotcha where @electric-sql/pglite's
// pglite.wasm/pglite.data get stripped from extraResources, or a bad
// migrations/seed path. This script closes that gap by:
//
//   1. Asserting the packaged pglite assets (pglite.wasm + pglite.data) are
//      present next to the server bundle in the unpacked output.
//   2. Launching the freshly built, packaged Electron app (the unpacked output
//      under release/) via Playwright's Electron driver — the real binary, real
//      bundled server child, real bundled resources.
//   3. Asserting the embedded server reaches /api/healthz and the dashboard
//      actually renders in the app window.
//
// A genuine runtime break (missing wasm, failed migrate/seed) means the embedded
// server never becomes healthy, so the app window never opens / healthz never
// returns 200 and this script exits non-zero, failing the job.

import { _electron as electron } from "playwright-core";
import {
  existsSync,
  readdirSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLlamaRuntime,
  checkLlamaRuntimeArchitecture,
} from "./llama-runtime-check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, ".."); // artifacts/desktop
const releaseDir = path.join(desktopDir, "release");

const LAUNCH_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;
const WATCHDOG_MS = 180_000;

function createOfflineModelFixture(directory) {
  // The offline-model lifecycle has its own tiny byte fixture. The custom-model
  // journey below uses a separately downloaded, real compatible GGUF.
  const fixture = path.join(directory, "packaged-smoke.gguf");
  const bytes = Buffer.alloc(1024 * 1024, 0);
  bytes.write("GGUF", 0, "ascii");
  bytes.writeUInt32LE(3, 4);
  writeFileSync(fixture, bytes, { mode: 0o600 });
  return fixture;
}

function createSecondaryGgufFixture(directory) {
  const fixture = path.join(directory, "packaged-smoke-secondary.gguf");
  const bytes = Buffer.alloc(1024 * 1024 + 8, 0x5a);
  bytes.write("GGUF", 0, "ascii");
  bytes.writeUInt32LE(3, 4);
  writeFileSync(fixture, bytes, { mode: 0o600 });
  return fixture;
}

function resolveOpenSsl() {
  const configured = process.env.OPENSSL_BIN?.trim();
  const candidates =
    process.platform === "win32"
      ? [
          configured,
          "openssl.exe",
          process.env.OPENSSL_HOME
            ? path.join(process.env.OPENSSL_HOME, "bin", "openssl.exe")
            : null,
          process.env.ProgramW6432
            ? path.join(
                process.env.ProgramW6432,
                "OpenSSL-Win64",
                "bin",
                "openssl.exe",
              )
            : null,
          process.env.ProgramFiles
            ? path.join(
                process.env.ProgramFiles,
                "OpenSSL-Win64",
                "bin",
                "openssl.exe",
              )
            : null,
          process.env.ProgramFiles
            ? path.join(
                process.env.ProgramFiles,
                "Git",
                "usr",
                "bin",
                "openssl.exe",
              )
            : null,
          process.env.ProgramFiles
            ? path.join(
                process.env.ProgramFiles,
                "Git",
                "mingw64",
                "bin",
                "openssl.exe",
              )
            : null,
          process.env.LOCALAPPDATA
            ? path.join(
                process.env.LOCALAPPDATA,
                "Programs",
                "Git",
                "usr",
                "bin",
                "openssl.exe",
              )
            : null,
          process.env.ChocolateyInstall
            ? path.join(process.env.ChocolateyInstall, "bin", "openssl.exe")
            : null,
        ]
      : [configured || "openssl"];
  const checked = [];

  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      const version = execFileSync(candidate, ["version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      if (!version) throw new Error("version command returned no output");
      log(`Windows HTTPS fixture found OpenSSL: ${version} (${candidate})`);
      return { command: candidate, version };
    } catch (error) {
      checked.push(
        `${candidate}: ${String(error?.stderr ?? error?.message ?? error).trim()}`,
      );
    }
  }

  throw new Error(
    [
      "Windows HTTPS smoke fixture requires OpenSSL to create its trusted localhost certificate.",
      configured
        ? `OPENSSL_BIN did not work: ${configured}`
        : "Set OPENSSL_BIN to the full path of openssl.exe if it is not on PATH.",
      "The Git for Windows OpenSSL binary and standard OpenSSL/Chocolatey locations were checked.",
      `Checked candidates: ${checked.join(" | ")}`,
      "Install OpenSSL on the Windows runner or update the runner image before rerunning the packaged smoke test.",
    ].join(" "),
  );
}

function createFixtureCertificate(directory) {
  const keyPath = path.join(directory, "packaged-smoke-fixture.key");
  const certPath = path.join(directory, "packaged-smoke-fixture.crt");
  const configPath = path.join(directory, "packaged-smoke-fixture.cnf");
  writeFileSync(
    configPath,
    [
      "[req]",
      "distinguished_name = req_distinguished_name",
      "x509_extensions = v3_req",
      "prompt = no",
      "",
      "[req_distinguished_name]",
      "CN = localhost",
      "",
      "[v3_req]",
      "subjectAltName = @alt_names",
      "",
      "[alt_names]",
      "DNS.1 = localhost",
      "IP.1 = 127.0.0.1",
      "",
    ].join("\n"),
  );
  const openssl = resolveOpenSsl();
  try {
    execFileSync(
      openssl.command,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-config",
        configPath,
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    throw new Error(
      [
        "Windows HTTPS smoke fixture could not create its localhost certificate with OpenSSL.",
        `OpenSSL preflight passed with ${openssl.version}.`,
        `Certificate generation failed: ${String(error?.stderr ?? error?.message ?? error).trim()}`,
        "Check the runner's OpenSSL installation and set OPENSSL_BIN to a working openssl.exe path.",
      ].join(" "),
    );
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath),
    caCertPath: certPath,
    certificateInfo: {
      generator: "openssl",
      command: openssl.command,
      version: openssl.version,
      certificatePath: certPath,
      trust: "NODE_EXTRA_CA_CERTS",
    },
  };
}

async function serveOfflineModelFixture(
  fixture,
  { httpsRedirect = false } = {},
) {
  const bytes = readFileSync(fixture);
  const certificate = httpsRedirect
    ? createFixtureCertificate(path.dirname(fixture))
    : null;
  let redirectCount = 0;
  const requests = [];
  const recordRequest = (status, details = {}) => {
    if (requests.length >= 64) return;
    requests.push({
      method: details.method ?? "GET",
      status,
      ...details,
    });
  };
  const serverHandler = (req, res) => {
    const requestPath = req.url ?? "/";
    const range = req.headers.range ?? null;
    if (httpsRedirect && req.url === "/offline-model.gguf") {
      redirectCount += 1;
      recordRequest(302, {
        method: req.method,
        path: requestPath,
        range,
        location: "/offline-model-target.gguf",
      });
      res.writeHead(302, { Location: "/offline-model-target.gguf" }).end();
      return;
    }
    const modelPath = httpsRedirect
      ? "/offline-model-target.gguf"
      : "/offline-model.gguf";
    if (req.url !== modelPath) {
      recordRequest(404, { method: req.method, path: requestPath, range });
      res.writeHead(404).end();
      return;
    }
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
      const end = Math.min(requestedEnd, bytes.length - 1);
      if (start >= bytes.length || end < start) {
        recordRequest(416, { method: req.method, path: requestPath, range });
        res
          .writeHead(416, { "Content-Range": `bytes */${bytes.length}` })
          .end();
        return;
      }
      recordRequest(206, { method: req.method, path: requestPath, range });
      res.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Type": "application/octet-stream",
      });
      res.end(bytes.subarray(start, end + 1));
      return;
    }
    recordRequest(200, { method: req.method, path: requestPath, range });
    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": bytes.length,
      "Content-Type": "application/octet-stream",
    });
    res.end(bytes);
  };
  const server = certificate
    ? createHttpsServer(certificate, serverHandler)
    : createHttpServer(serverHandler);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error(
      "offline-model fixture server did not expose a TCP address",
    );
  }
  return {
    server,
    url: `${certificate ? "https" : "http"}://127.0.0.1:${address.port}/offline-model.gguf`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    caCertPath: certificate?.caCertPath,
    certificateInfo: certificate?.certificateInfo ?? null,
    requestSequence: () => requests.slice(),
    get redirectCount() {
      return redirectCount;
    },
  };
}

async function serveDisposableUpdateFeed(diagnosticsDir) {
  const fixtureDir = mkdtempSync(path.join(os.tmpdir(), "engram-update-feed-"));
  const artifactName = "engram-disposable-update.AppImage";
  const artifactPath = path.join(fixtureDir, artifactName);
  const artifactBytes = Buffer.alloc(128 * 1024, 0x5a);
  artifactBytes.write("ENGRAM-DISPOSABLE-UPDATE", 0, "ascii");
  writeFileSync(artifactPath, artifactBytes, { mode: 0o600 });
  const artifactSha512 = createHash("sha512")
    .update(artifactBytes)
    .digest("base64");
  const metadata = [
    "version: 999.0.0",
    "files:",
    `  - url: ${artifactName}`,
    `    sha512: ${artifactSha512}`,
    `    size: ${artifactBytes.length}`,
    `path: ${artifactName}`,
    `sha512: ${artifactSha512}`,
    "releaseDate: 2026-09-14T00:00:00.000Z",
    "",
  ].join("\n");
  const requests = [];
  const server = createHttpServer((req, res) => {
    const requestUrl = req.url ?? "/";
    const requestPath = new URL(requestUrl, "http://127.0.0.1").pathname;
    const status =
      requestPath === "/latest-linux.yml" || requestPath === `/${artifactName}`
        ? 200
        : 404;
    if (requests.length < 32) {
      requests.push({
        method: req.method ?? "GET",
        path: requestUrl,
        status,
      });
    }
    if (requestPath === "/latest-linux.yml") {
      res.writeHead(200, {
        "Content-Length": Buffer.byteLength(metadata),
        "Content-Type": "text/yaml",
      });
      res.end(metadata);
      return;
    }
    if (requestPath === `/${artifactName}`) {
      res.writeHead(200, {
        "Accept-Ranges": "bytes",
        "Content-Length": artifactBytes.length,
        "Content-Type": "application/octet-stream",
      });
      res.end(artifactBytes);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    rmSync(fixtureDir, { recursive: true, force: true });
    throw new Error("disposable update feed did not expose a TCP address");
  }
  let closed = false;
  return {
    url: `http://127.0.0.1:${address.port}/`,
    artifactName,
    artifactBytes: artifactBytes.length,
    requestCount: () => requests.length,
    artifactRequestCount: () =>
      requests.filter((request) => request.path === `/${artifactName}`).length,
    close: async () => {
      if (closed) return;
      closed = true;
      let closeError;
      try {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      } catch (error) {
        closeError = error;
      }
      try {
        const diagnostic = JSON.stringify(
          {
            feed: "disposable-loopback",
            artifact: artifactName,
            artifactBytes: artifactBytes.length,
            requests,
          },
          null,
          2,
        ).slice(0, 8192);
        writeFileSync(
          path.join(diagnosticsDir, "update-feed.json"),
          `${diagnostic}\n`,
        );
      } catch (error) {
        closeError ??= error;
      }
      try {
        rmSync(fixtureDir, { recursive: true, force: true });
      } catch (error) {
        closeError ??= error;
      }
      if (closeError) {
        throw new Error(`disposable update feed cleanup failed: ${String(closeError)}`);
      }
    },
  };
}

function log(msg) {
  console.log(`[smoke] ${sanitizeSmokeText(msg)}`);
}

async function waitForServerStopped(healthUrl) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(healthUrl);
      if (!response.ok) return;
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `shutdown ordering phase failed: embedded server still answered ${healthUrl} after installer handoff`,
  );
}

async function runPackagedUpdateSmoke(
  bridgeWindow,
  healthUrl,
  diagnosticsDir,
) {
  let updateResult;
  try {
    updateResult = await bridgeWindow.evaluate(async () => {
      const statuses = [];
      const unsubscribe = window.engram.onUpdateStatus((status) => {
        statuses.push(status);
      });
      try {
        await window.engram.checkForUpdates();
        const deadline = Date.now() + 15_000;
        while (
          Date.now() < deadline &&
          !statuses.some((status) => status.state === "downloaded")
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          statuses,
          appInfo: await window.engram.getAppInfo(),
        };
      } finally {
        unsubscribe();
      }
    });
  } catch (error) {
    throw new Error(`feed setup phase failed: ${String(error)}`);
  }

  const states = updateResult.statuses.map((status) => status.state);
  if (!states.includes("checking") || !states.includes("available")) {
    throw new Error(
      `feed setup phase failed: expected checking/available states, got ${JSON.stringify(updateResult)}`,
    );
  }
  if (!states.includes("downloading") || !states.includes("downloaded")) {
    throw new Error(
      `download handling phase failed: expected downloading/downloaded states, got ${JSON.stringify(updateResult)}`,
    );
  }
  if (updateResult.appInfo.updateStatus.state !== "downloaded") {
    throw new Error(
      `download handling phase failed: app info did not retain downloaded state: ${JSON.stringify(updateResult.appInfo)}`,
    );
  }
  let healthBeforeInstall;
  try {
    const response = await fetch(healthUrl);
    healthBeforeInstall = {
      status: response.status,
      body: await response.text(),
    };
  } catch (error) {
    throw new Error(
      `download handling phase failed: server was not healthy after defer: ${String(error)}`,
    );
  }
  if (healthBeforeInstall.status !== 200) {
    throw new Error(
      `download handling phase failed: server was not healthy after defer (${healthBeforeInstall.status}, ${healthBeforeInstall.body})`,
    );
  }
  log("packaged updater feed, download, and defer states passed");

  let installResult;
  try {
    installResult = await bridgeWindow.evaluate(() =>
      window.engram.installDownloadedUpdate(),
    );
  } catch (error) {
    throw new Error(`shutdown ordering phase failed: ${String(error)}`);
  }
  if (!installResult?.ok) {
    throw new Error(
      `shutdown ordering phase failed: ${installResult?.error ?? "installer handoff was rejected"}`,
    );
  }
  await waitForServerStopped(healthUrl);

  const updateLogPath = path.join(diagnosticsDir, "update.log");
  const updateLog = existsSync(updateLogPath)
    ? readFileSync(updateLogPath, "utf8")
    : "";
  const requiredPhases = [
    "phase=feed-setup",
    "phase=download-progress",
    "phase=downloaded",
    "phase=deferred",
    "phase=server-stopped",
    "phase=quit-and-install",
  ];
  for (const phase of requiredPhases) {
    if (!updateLog.includes(phase)) {
      throw new Error(
        `${phase === "server-stopped" || phase === "quit-and-install" ? "shutdown ordering" : "download handling"} phase failed: missing ${phase} in ${updateLogPath}`,
      );
    }
  }
  if (
    updateLog.indexOf("phase=server-stopped") >
    updateLog.indexOf("phase=quit-and-install")
  ) {
    throw new Error(
      `shutdown ordering phase failed: quit-and-install preceded server-stopped\n${updateLog}`,
    );
  }
  log("packaged updater restart handoff waited for embedded server shutdown");
}

async function runDisposableUpdateFeedSmoke(
  executablePath,
  baseArgs,
  env,
  feed,
) {
  const feedUserDataDir = mkdtempSync(
    path.join(os.tmpdir(), "engram-update-feed-user-data-"),
  );
  const feedArgs = [
    ...baseArgs.filter((arg) => !arg.startsWith("--user-data-dir=")),
    `--user-data-dir=${feedUserDataDir}`,
  ];
  const feedAppImagePath = path.join(
    feedUserDataDir,
    "disposable-update-placeholder.AppImage",
  );
  let feedApp;
  try {
    feedApp = await electron.launch({
      executablePath,
      args: feedArgs,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...env,
        ENGRAM_PACKAGED_UPDATE_FEED_URL: feed.url,
        APPIMAGE: feedAppImagePath,
      },
    });
    const feedWindow = await feedApp.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    await feedWindow.waitForLoadState("domcontentloaded");
    const settingsPromise = feedApp
      .waitForEvent("window", { timeout: 5_000 })
      .catch(() => null);
    await feedWindow.keyboard.press(
      process.platform === "darwin" ? "Meta+," : "Control+,",
    );
    const settings =
      (await settingsPromise) ??
      feedApp.windows().find((candidate) => candidate !== feedWindow);
    if (!settings) {
      throw new Error("Settings window did not open for disposable feed.");
    }
    await settings.waitForLoadState("domcontentloaded");
    const updateResult = await settings.evaluate(async () => {
      const statuses = [];
      const unsubscribe = window.engram.onUpdateStatus((status) => {
        statuses.push(status);
      });
      try {
        await window.engram.checkForUpdates();
        const deadline = Date.now() + 30_000;
        while (
          Date.now() < deadline &&
          !statuses.some((status) => status.state === "downloaded")
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return {
          statuses,
          appInfo: await window.engram.getAppInfo(),
        };
      } finally {
        unsubscribe();
      }
    });
    const states = updateResult.statuses.map((status) => status.state);
    if (!states.includes("checking") || !states.includes("available")) {
      throw new Error(
        `feed setup phase failed: ${JSON.stringify(updateResult)}`,
      );
    }
    if (!states.includes("downloading") || !states.includes("downloaded")) {
      throw new Error(
        `download handling phase failed: ${JSON.stringify(updateResult)}`,
      );
    }
    if (updateResult.appInfo.updateStatus.state !== "downloaded") {
      throw new Error(
        `download handling phase failed: app info did not retain downloaded state: ${JSON.stringify(updateResult.appInfo)}`,
      );
    }
    if (feed.requestCount() < 2 || feed.artifactRequestCount() < 1) {
      throw new Error(
        `download handling phase failed: feed requests were incomplete (${feed.requestCount()} total, ${feed.artifactRequestCount()} artifact)`,
      );
    }
    log(
      `disposable updater feed metadata and ${feed.artifactBytes}-byte artifact reached downloaded state`,
    );
  } catch (error) {
    throw new Error(`disposable update feed check failed: ${String(error)}`);
  } finally {
    if (feedApp) {
      try {
        await feedApp.close();
      } catch (error) {
        const proc = feedApp.process();
        if (proc && !proc.killed) proc.kill("SIGKILL");
        throw new Error(`disposable update app cleanup failed: ${String(error)}`);
      }
    }
    try {
      rmSync(feedUserDataDir, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`disposable update userData cleanup failed: ${String(error)}`);
    }
  }
}

const smokeWorkspaceRoot = path.resolve(desktopDir, "..", "..");
const smokeSecretValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      Boolean(value) &&
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL)/i.test(name),
  )
  .map(([, value]) => value)
  .filter((value) => value && value.length >= 4);

function sanitizeSmokeText(value) {
  let safe = String(value);
  const replacements = [
    [process.env.GITHUB_WORKSPACE, "<workspace>"],
    [smokeWorkspaceRoot, "<workspace>"],
    [desktopDir, "<workspace>/artifacts/desktop"],
    [os.tmpdir(), "<tmp>"],
    [os.homedir(), "<home>"],
    [process.env.ENGRAM_PACKAGED_GGUF_FIXTURE, "<gguf-fixture>"],
  ];
  for (const [source, replacement] of replacements) {
    if (source) safe = safe.split(source).join(replacement);
  }
  for (const secret of smokeSecretValues) {
    safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[redacted]",
    );
}

let activeSmokeDiagnostics = null;
let activeOfflineFixture = null;

function classifySmokeFailure(message) {
  const text = String(message).toLowerCase();
  if (text.includes("macos packaging failure")) return "packaging";
  if (text.includes("macos signing failure")) return "signing";
  if (text.includes("dylib") || text.includes("mach-o")) return "dylib-loading";
  if (text.includes("local gguf") || text.includes("model startup")) {
    return "model-startup";
  }
  if (text.includes("certificate") || text.includes("openssl") || text.includes("tls")) {
    return "certificate";
  }
  if (text.includes("redirect")) return "redirect";
  if (text.includes("permission") || text.includes("materialized")) {
    return "write-permission";
  }
  if (text.includes("verif")) return "verification";
  if (text.includes("activat")) return "activation";
  if (text.includes("remov")) return "removal";
  return "other";
}

function writeSmokeDiagnostics() {
  const diagnostics = activeSmokeDiagnostics;
  if (!diagnostics?.diagnosticsDir) return;
  try {
    if (activeOfflineFixture) {
      diagnostics.fixture.redirectCount = activeOfflineFixture.redirectCount;
      diagnostics.fixture.requestSequence =
        activeOfflineFixture.requestSequence();
    }
    diagnostics.userData.final = {
      root: diagnostics.userData.root,
      offlineModelPath: diagnostics.userData.offlineModelPath,
      offlineModelPartialPath: diagnostics.userData.offlineModelPartialPath,
      finalExists: existsSync(diagnostics.userData.offlineModelPath),
      partialExists: existsSync(
        diagnostics.userData.offlineModelPartialPath,
      ),
    };
    writeFileSync(
      path.join(diagnostics.diagnosticsDir, "offline-model-smoke.json"),
      `${sanitizeSmokeText(JSON.stringify(diagnostics, null, 2))}\n`,
    );
  } catch (error) {
    console.error(
      `[smoke] Could not write offline-model diagnostics: ${sanitizeSmokeText(error)}`,
    );
  }
}

function fail(msg) {
  if (activeSmokeDiagnostics) {
    const message = String(msg);
    activeSmokeDiagnostics.failure = {
      category: classifySmokeFailure(message),
      message: sanitizeSmokeText(message),
    };
    writeSmokeDiagnostics();
  }
  console.error(`[smoke] FAIL: ${sanitizeSmokeText(msg)}`);
  process.exit(1);
}

// Hard backstop so a hung launch (e.g. a blocking native error dialog on a
// failed startup) can never wedge the CI job indefinitely.
const watchdog = setTimeout(() => {
  fail(`smoke test exceeded ${WATCHDOG_MS}ms without completing`);
}, WATCHDOG_MS);
watchdog.unref();

// ---------------------------------------------------------------------------
// Locate the unpacked app output for this platform. electron-builder leaves an
// unpacked dir next to the installers; using it needs no extraction.
// ---------------------------------------------------------------------------
function locate() {
  const platform = process.platform;

  // Find the actual executable in a dir, falling back to a name scan since the
  // executableName (electron-builder.yml) drives the basename.
  const pickExe = (dir, preferred) => {
    const direct = path.join(dir, preferred);
    if (existsSync(direct)) return direct;
    return null;
  };

  if (platform === "linux") {
    const dir = path.join(releaseDir, "linux-unpacked");
    return {
      dir,
      exe: pickExe(dir, "engram"),
      resources: path.join(dir, "resources"),
    };
  }
  if (platform === "win32") {
    const dir = path.join(releaseDir, "win-unpacked");
    return {
      dir,
      exe: pickExe(dir, "engram.exe"),
      resources: path.join(dir, "resources"),
    };
  }
  if (platform === "darwin") {
    const macDir = readdirSync(releaseDir).find((d) => d.startsWith("mac"));
    if (!macDir) fail(`no mac* output directory under ${releaseDir}`);
    const appDir = path.join(releaseDir, macDir, "ENGRAM.app");
    const macOsDir = path.join(appDir, "Contents", "MacOS");
    let exe = pickExe(macOsDir, "engram");
    if (!exe && existsSync(macOsDir)) {
      const found = readdirSync(macOsDir)[0];
      exe = found ? path.join(macOsDir, found) : null;
    }
    return {
      dir: appDir,
      exe,
      resources: path.join(appDir, "Contents", "Resources"),
    };
  }
  return fail(`unsupported platform: ${platform}`);
}

const { dir, exe, resources } = locate();

if (!exe || !existsSync(exe)) {
  fail(
    `packaged executable not found (looked under ${dir}). Did packaging run?`,
  );
}
log(`packaged app: ${exe}`);

if (process.platform === "darwin") {
  const expectedArchitecture = process.env.ENGRAM_EXPECTED_ARCH?.trim();
  const expectedMachArchitecture =
    expectedArchitecture === "x64" ? "x86_64" : expectedArchitecture;
  if (!expectedMachArchitecture) {
    fail(
      "macOS packaging failure: ENGRAM_EXPECTED_ARCH was not set for the architecture smoke test",
    );
  }
  let packagedArchitectures;
  try {
    packagedArchitectures = execFileSync("lipo", ["-archs", exe], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    fail(
      `macOS packaging failure: could not inspect packaged app architecture: ${String(error?.message ?? error)}`,
    );
  }
  if (!packagedArchitectures.split(/\s+/).includes(expectedMachArchitecture)) {
    fail(
      `macOS packaging failure: expected ${expectedMachArchitecture}, found ${packagedArchitectures || "no architectures"} in ${exe}`,
    );
  }
  log(
    `macOS packaged architecture verified (${packagedArchitectures}; expected ${expectedMachArchitecture})`,
  );
}

// ---------------------------------------------------------------------------
// 1. PGlite assets must ship next to the server bundle, or the embedded DB
//    can't open and the server crashes on boot.
// ---------------------------------------------------------------------------
const pgliteDist = path.join(
  resources,
  "server",
  "node_modules",
  "@electric-sql",
  "pglite",
  "dist",
);
for (const asset of ["pglite.wasm", "pglite.data"]) {
  const p = path.join(pgliteDist, asset);
  if (!existsSync(p)) {
    fail(
      `packaged pglite asset missing: ${p}\n` +
        "  -> electron-builder likely stripped node_modules from extraResources " +
        "(see the desktop packaging gotcha in replit.md).",
    );
  }
}
log("pglite.wasm + pglite.data present next to the server bundle");

const llamaServer = path.join(
  resources,
  "llama",
  "bin",
  process.platform === "win32" ? "llama-server.exe" : "llama-server",
);
if (!existsSync(llamaServer)) {
  fail(`packaged custom-GGUF runtime missing: ${llamaServer}`);
}
const expectedLlamaArchitecture =
  process.env.ENGRAM_EXPECTED_ARCH?.trim() || process.arch;
const llamaArchitectureResult = checkLlamaRuntimeArchitecture({
  executablePath: llamaServer,
  platform: process.platform,
  architecture: expectedLlamaArchitecture,
});
if (!llamaArchitectureResult.ok) {
  fail(
    `llama.cpp runtime architecture preflight failed for staged binary ` +
      `${llamaServer}: ${llamaArchitectureResult.message}`,
  );
}
log(
  `llama.cpp staged architecture verified (` +
    `${llamaArchitectureResult.architectures.join(", ")}; expected ` +
    `${process.platform}-${expectedLlamaArchitecture})`,
);
const llamaRuntime = checkLlamaRuntime({
  executablePath: llamaServer,
  platform: process.platform,
  architecture: expectedLlamaArchitecture,
});
if (!llamaRuntime.ok) {
  fail(
    `llama.cpp runtime preflight failed (${llamaRuntime.code}) for staged ` +
      `binary ${llamaServer}: ${llamaRuntime.message}`,
  );
}
log(
  `trusted llama.cpp runtime present for managed custom GGUFs ` +
    `(${llamaRuntime.code})`,
);

if (
  process.env.EXPECT_SLIM_LLM === "1" &&
  existsSync(path.join(resources, "llama", "model.gguf"))
) {
  fail("slim package unexpectedly contains the multi-GB default GGUF");
}
if (process.env.EXPECT_SLIM_LLM === "1") {
  log("slim package omits the default GGUF");
}

// ---------------------------------------------------------------------------
// 2 + 3. Launch the packaged app and assert it actually comes up.
// ---------------------------------------------------------------------------
async function main() {
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "engram-smoke-"));
  const smokeDiagnosticsDir =
    process.env.ENGRAM_SMOKE_DIAGNOSTICS_DIR ??
    path.join(userDataDir, "smoke-diagnostics");
  mkdirSync(smokeDiagnosticsDir, { recursive: true });
  rmSync(path.join(smokeDiagnosticsDir, "update.log"), { force: true });
  const offlineModelPath = path.join(
    userDataDir,
    "models",
    "offline",
    "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  );
  const offlineModelPartialPath = `${offlineModelPath}.partial`;
  const diagnostics = {
    platform: process.platform,
    diagnosticsDir: smokeDiagnosticsDir,
    userData: {
      root: userDataDir,
      offlineModelPath,
      offlineModelPartialPath,
      checkpoints: [],
    },
    fixture: {
      url: null,
      bytes: null,
      sha256: null,
      redirectCount: 0,
      requestSequence: [],
      certificate: null,
      trust: null,
    },
    phases: {},
    failure: null,
  };
  activeSmokeDiagnostics = diagnostics;
  const markPhase = (name, details = {}) => {
    diagnostics.phases[name] = details;
    writeSmokeDiagnostics();
  };
  let offlineFixture;
  try {
  const ggufFixture = process.env.ENGRAM_PACKAGED_GGUF_FIXTURE;
  const multiModelSmoke =
    process.env.ENGRAM_PACKAGED_GGUF_MULTI_MODEL === "1";
  const secondaryGgufFixture = multiModelSmoke
    ? createSecondaryGgufFixture(userDataDir)
    : null;
  if (
    !ggufFixture ||
    !path.isAbsolute(ggufFixture) ||
    !existsSync(ggufFixture)
  ) {
    fail(
      "a real compatible GGUF fixture is required; set " +
        "ENGRAM_PACKAGED_GGUF_FIXTURE to a downloaded test model",
    );
  }
  for (const fixture of [ggufFixture, secondaryGgufFixture].filter(Boolean)) {
    if (
      path
        .resolve(fixture)
        .startsWith(`${path.resolve(resources)}${path.sep}`)
    ) {
      fail(
        "the GGUF smoke fixture must not be staged inside installer resources",
      );
    }
    const ggufHeader = readFileSync(fixture).subarray(0, 8);
    if (
      ggufHeader.length !== 8 ||
      ggufHeader.toString("ascii", 0, 4) !== "GGUF" ||
      ggufHeader.readUInt32LE(4) < 1 ||
      ggufHeader.readUInt32LE(4) > 3
    ) {
      fail(`invalid GGUF smoke fixture: ${fixture}`);
    }
  }
  const useHttpsRedirectFixture =
    process.env.ENGRAM_PACKAGED_OFFLINE_MODEL_HTTPS === "1";
  if (useHttpsRedirectFixture && process.platform !== "win32") {
    fail(
      "the HTTPS redirect offline-model fixture is reserved for Windows smoke",
    );
  }
  if (
    useHttpsRedirectFixture &&
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
  ) {
    fail(
      "Windows HTTPS smoke must validate the fixture certificate; unset NODE_TLS_REJECT_UNAUTHORIZED instead of disabling TLS verification",
    );
  }
  offlineFixture = await serveOfflineModelFixture(
    createOfflineModelFixture(userDataDir),
    { httpsRedirect: useHttpsRedirectFixture },
  );
  activeOfflineFixture = offlineFixture;
  diagnostics.fixture = {
    url: offlineFixture.url,
    bytes: offlineFixture.bytes,
    sha256: offlineFixture.sha256,
    redirectCount: offlineFixture.redirectCount,
    requestSequence: offlineFixture.requestSequence(),
    certificate: offlineFixture.certificateInfo,
    trust: offlineFixture.caCertPath
      ? {
          mechanism: "NODE_EXTRA_CA_CERTS",
          certificatePath: offlineFixture.caCertPath,
        }
      : null,
  };
  markPhase("fixture", {
    certificate: offlineFixture.certificateInfo ? "configured" : "not-used",
    trust: offlineFixture.caCertPath ? "NODE_EXTRA_CA_CERTS" : "not-used",
  });
  const offlineModelFixtureEnv = {
    ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE: "1",
    ENGRAM_PACKAGED_OFFLINE_MODEL_URL: offlineFixture.url,
    ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES: String(offlineFixture.bytes),
    ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256: offlineFixture.sha256,
    ...(offlineFixture.caCertPath
      ? { NODE_EXTRA_CA_CERTS: offlineFixture.caCertPath }
      : {}),
  };
  if (useHttpsRedirectFixture) {
    log(
      "Windows offline-model fixture is HTTPS with a redirect and a trusted test certificate",
    );
  }
  const args = [`--user-data-dir=${userDataDir}`];
  const customRuntimeEnv =
    process.env.ENGRAM_PACKAGED_GGUF_REAL_RUNTIME === "1" || !multiModelSmoke
      ? { ENGRAM_PACKAGED_GGUF_REAL_RUNTIME: "1" }
      : {};
  // CI Linux runs under xvfb as a privileged user with no GPU; these switches
  // keep Electron from refusing to start. They are no-ops on the runtime paths
  // this test exercises (embedded server + dashboard render).
  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage");
  }

  log("launching packaged app…");
  const app = await electron.launch({
    executablePath: exe,
    args,
    timeout: LAUNCH_TIMEOUT_MS,
    env: {
      ...process.env,
      ...offlineModelFixtureEnv,
      CI: "true",
      GITHUB_ACTIONS: "true",
      ENGRAM_PACKAGED_GGUF_SMOKE: "1",
      ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
      ...(secondaryGgufFixture
        ? { ENGRAM_PACKAGED_GGUF_FIXTURE_B: secondaryGgufFixture }
        : {}),
      ...customRuntimeEnv,
      ENGRAM_PACKAGED_UPGRADE_STAGE: "A",
      ENGRAM_SMOKE_DIAGNOSTICS_DIR: smokeDiagnosticsDir,
    },
  });

  try {
    // The main window only opens after the embedded server becomes healthy
    // (startServer awaits waitForHealth before createMainWindow). If migrations,
    // seed, or pglite are broken, the server never goes healthy and no window
    // appears -> firstWindow times out -> this throws -> job fails.
    let window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    let url;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await window.waitForLoadState("domcontentloaded");
      url = window.url();
      if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) break;
      const loopbackWindow = app
        .windows()
        .find((candidate) =>
          /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()),
        );
      if (loopbackWindow) {
        window = loopbackWindow;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(window.url())) {
      throw new Error(
        `unexpected window URL (expected loopback): ${window.url()}`,
      );
    }
    log(`window loaded: ${window.url()}`);

    // Dashboard actually rendered: React mounted content into #root.
    await window.waitForFunction(
      () => {
        const root = document.querySelector("#root");
        return !!root && root.children.length > 0;
      },
      undefined,
      { timeout: RENDER_TIMEOUT_MS },
    );
    log("dashboard rendered (#root has content)");

    // Embedded server is healthy, checked same-origin from the running app.
    const health = await window.evaluate(async () => {
      const res = await fetch("/api/healthz");
      return { status: res.status, body: await res.text() };
    });
    if (health.status !== 200) {
      throw new Error(
        `/api/healthz returned ${health.status} (body: ${health.body})`,
      );
    }
    log("/api/healthz -> 200 OK");

    // Open Settings through the same production menu/IPC path. In CI the main
    // process substitutes the downloaded fixture for the native picker result;
    // the renderer still receives only the allowlisted inspection payload.
    const settingsPromise = app
      .waitForEvent("window", { timeout: 5_000 })
      .catch(() => null);
    await window.keyboard.press(
      process.platform === "darwin" ? "Meta+," : "Control+,",
    );
    const settings =
      (await settingsPromise) ??
      app.windows().find((candidate) => candidate !== window);
    if (!settings) {
      throw new Error(
        "Settings window did not open from the application menu.",
      );
    }
    await settings.waitForLoadState("domcontentloaded");
    const customImport = await settings.evaluate(async (sourcePath) => {
      const selection = await window.engram.chooseGguf();
      if (!selection.ok) {
        throw new Error(selection.error ?? "native GGUF picker failed");
      }
      const selectionPayload = JSON.stringify(selection.selection);
      if (selectionPayload.includes(sourcePath)) {
        throw new Error(
          "GGUF source path leaked into the renderer selection payload",
        );
      }
      if (
        selection.selection.filename !== "SmolLM2-135M-Instruct-Q4_K_M.gguf" ||
        selection.selection.byteSize < 1_000_000 ||
        selection.selection.ggufVersion < 1 ||
        selection.selection.ggufVersion > 3
      ) {
        throw new Error(
          `unexpected native GGUF selection: ${selectionPayload}`,
        );
      }

      const cancelledStates = [];
      let cancelRequested = false;
      let cancelError;
      let resolveCancelled;
      let rejectCancelled;
      const cancelledDone = new Promise((resolve, reject) => {
        resolveCancelled = resolve;
        rejectCancelled = reject;
      });
      const unsubscribeCancelled = window.engram.onGgufImportStatus(
        (status) => {
          cancelledStates.push(status.state);
          if (status.state === "copying" && !cancelRequested) {
            cancelRequested = true;
            void window.engram
              .cancelGgufImport(status.operationId)
              .catch((error) => {
                cancelError = String(error);
                rejectCancelled(error);
              });
          }
          if (status.state === "cancelled" || status.state === "error") {
            resolveCancelled(status);
          }
        },
      );
      const cancelledImport = await window.engram.importGguf(
        selection.selection.selectionId,
      );
      if (!cancelledImport.ok || !cancelledImport.operationId) {
        unsubscribeCancelled();
        throw new Error(
          cancelledImport.error ?? "GGUF cancellation import did not start",
        );
      }
      const cancelledStatus = await cancelledDone;
      unsubscribeCancelled();
      if (
        cancelError ||
        cancelledStatus.state !== "cancelled" ||
        !cancelRequested
      ) {
        throw new Error(
          `GGUF cancellation did not complete cleanly: ${JSON.stringify({
            cancelledStates,
            cancelledStatus,
            cancelError,
          })}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
      const secondSelection = await window.engram.chooseGguf();
      if (!secondSelection.ok) {
        throw new Error(
          secondSelection.error ?? "native GGUF picker retry failed",
        );
      }
      const importStates = [];
      let resolveImported;
      let rejectImported;
      const importedDone = new Promise((resolve, reject) => {
        resolveImported = resolve;
        rejectImported = reject;
      });
      const unsubscribeImported = window.engram.onGgufImportStatus((status) => {
        importStates.push(status.state);
        if (status.state === "completed") resolveImported(status);
        if (status.state === "error" || status.state === "cancelled") {
          rejectImported(
            new Error(status.error ?? `GGUF import ${status.state}`),
          );
        }
      });
      const imported = await window.engram.importGguf(
        secondSelection.selection.selectionId,
      );
      if (!imported.ok || !imported.operationId) {
        unsubscribeImported();
        throw new Error(imported.error ?? "GGUF import did not start");
      }
      const completedStatus = await importedDone;
      unsubscribeImported();
      const value = await window.engram.getSettings();
      return {
        cancelledStates,
        importStates,
        completedStatus,
        customModel: value.customModel,
        customModels: value.customModels.map((model) => ({
          status: model.status,
          fingerprint: model.metadata?.sha256,
        })),
        mode: value.mode,
      };
    }, ggufFixture);
    const secondCustomImport = multiModelSmoke
      ? await settings.evaluate(async () => {
          const selection = await window.engram.chooseGguf();
          if (!selection.ok) {
            throw new Error(
              selection.error ?? "second GGUF picker selection failed",
            );
          }
          let resolveImported;
          let rejectImported;
          const importedDone = new Promise((resolve, reject) => {
            resolveImported = resolve;
            rejectImported = reject;
          });
          const unsubscribe = window.engram.onGgufImportStatus((status) => {
            if (status.state === "completed") resolveImported(status);
            if (status.state === "error" || status.state === "cancelled") {
              rejectImported(
                new Error(status.error ?? `GGUF import ${status.state}`),
              );
            }
          });
          try {
            const imported = await window.engram.importGguf(
              selection.selection.selectionId,
            );
            if (!imported.ok || !imported.operationId) {
              throw new Error(
                imported.error ?? "second GGUF import did not start",
              );
            }
            await importedDone;
            const value = await window.engram.getSettings();
            return {
              customModel: value.customModel,
              customModels: value.customModels.map((model) => ({
                status: model.status,
                fingerprint: model.metadata?.sha256,
              })),
              mode: value.mode,
            };
          } finally {
            unsubscribe();
          }
        })
      : null;
    const currentCustomImport = secondCustomImport ?? customImport;
    const customStatus = {
      mode: currentCustomImport.mode,
      status: currentCustomImport.customModel.status,
      fingerprint: currentCustomImport.customModel.metadata?.sha256,
    };
    const customFingerprints = currentCustomImport.customModels
      .map((model) => model.fingerprint)
      .filter((fingerprint) => typeof fingerprint === "string");
    if (
      !customImport.cancelledStates.includes("copying") ||
      !customImport.cancelledStates.includes("cancelled") ||
      !customImport.importStates.includes("copying") ||
      !customImport.importStates.includes("activating") ||
      !customImport.importStates.includes("completed")
    ) {
      throw new Error(
        `custom GGUF progress journey was incomplete: ${JSON.stringify(customImport)}`,
      );
    }
    if (
      customStatus.mode !== "custom" ||
      customStatus.status !== "active" ||
      !/^[a-f0-9]{64}$/.test(customStatus.fingerprint ?? "")
    ) {
      throw new Error(
        `custom GGUF import/selection/launch was not active: ${JSON.stringify(customStatus)}`,
      );
    }
    if (process.env.ENGRAM_PACKAGED_GGUF_REQUEST_SMOKE === "1") {
      const mainLogPath = path.join(smokeDiagnosticsDir, "main.log");
      const mainLog = existsSync(mainLogPath)
        ? readFileSync(mainLogPath, "utf8")
        : "";
      if (!mainLog.includes("packaged local GGUF completion request passed")) {
        throw new Error(
          `local GGUF model startup phase failed: completion request marker was missing from ${mainLogPath}`,
        );
      }
      log("real local GGUF completion request passed through llama.cpp");
    }
    if (multiModelSmoke && customFingerprints.length !== 2) {
      throw new Error(
        `two managed GGUF entries were not imported: ${JSON.stringify(
          customImport.customModels,
        )}`,
      );
    }
    const fallbackFingerprint = multiModelSmoke
      ? customFingerprints.find(
          (fingerprint) => fingerprint !== customStatus.fingerprint,
        )
      : undefined;
    if (multiModelSmoke && !fallbackFingerprint) {
      throw new Error(
        `could not identify the non-active managed GGUF fallback: ${JSON.stringify(
          customImport.customModels,
        )}`,
      );
    }
    const customStorePath = path.join(userDataDir, "models", "custom");
    const customEntries = readdirSync(customStorePath);
    if (
      customEntries.some((entry) => entry.endsWith(".partial")) ||
      !customEntries.includes(`${customStatus.fingerprint}.gguf`)
    ) {
      throw new Error(
        `custom GGUF store was not transactional: ${JSON.stringify(customEntries)}`,
      );
    }
    log(
      "custom GGUF picker, progress, cancellation, activation, and launch path active",
    );

    await app.close();
    log("custom GGUF persisted after shutdown");

    const customRestartedApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        ...offlineModelFixtureEnv,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
         ...(secondaryGgufFixture
           ? { ENGRAM_PACKAGED_GGUF_FIXTURE_B: secondaryGgufFixture }
           : {}),
         ...customRuntimeEnv,
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "custom-restart",
        ENGRAM_SMOKE_DIAGNOSTICS_DIR: smokeDiagnosticsDir,
      },
    });
    let customRestartedSettings;
    const expectedOfflineStatus =
      process.env.EXPECT_SLIM_LLM === "1" ? "active" : "available";
    let downloadedStatus;
    try {
      const restartedWindow = await customRestartedApp.firstWindow({
        timeout: LAUNCH_TIMEOUT_MS,
      });
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedSettingsPromise = customRestartedApp
        .waitForEvent("window", { timeout: 5_000 })
        .catch(() => null);
      await restartedWindow.keyboard.press(
        process.platform === "darwin" ? "Meta+," : "Control+,",
      );
      customRestartedSettings =
        (await restartedSettingsPromise) ??
        customRestartedApp
          .windows()
          .find((candidate) => candidate !== restartedWindow);
      if (!customRestartedSettings) {
        throw new Error(
          "Settings window did not open after custom GGUF restart.",
        );
      }
      await customRestartedSettings.waitForLoadState("domcontentloaded");
      const persistedCustom = await customRestartedSettings.evaluate(
        async () => {
          const value = await window.engram.getSettings();
          return {
            mode: value.mode,
            status: value.customModel.status,
            fingerprint: value.customModel.metadata?.sha256,
            customModels: value.customModels.map((model) => ({
              status: model.status,
              fingerprint: model.metadata?.sha256,
            })),
          };
        },
      );
      if (
        persistedCustom.mode !== "custom" ||
        persistedCustom.status !== "active" ||
        persistedCustom.fingerprint !== customStatus.fingerprint
      ) {
        throw new Error(
          `custom GGUF was not active after restart: ${JSON.stringify(persistedCustom)}`,
        );
      }
      if (
        multiModelSmoke &&
        (persistedCustom.customModels.length !== 2 ||
          !persistedCustom.customModels.every((model) =>
            customFingerprints.includes(model.fingerprint),
          ))
      ) {
        throw new Error(
          `both managed GGUF entries did not survive restart: ${JSON.stringify(
            persistedCustom,
          )}`,
        );
      }
      log(
        multiModelSmoke
          ? "both managed GGUF entries survived restart with the selected model preserved"
          : "custom GGUF survived restart and was re-verified by the packaged runtime",
      );

      const removedCustom = multiModelSmoke
        ? await customRestartedSettings.evaluate(
            async ({ fallbackModel, activeModel }) => {
              const activated = await window.engram.activateGguf(fallbackModel);
              if (!activated.ok) {
                throw new Error(
                  activated.error ?? "custom GGUF switch failed",
                );
              }
              const switched = await window.engram.getSettings();
              if (
                switched.mode !== "custom" ||
                switched.customModel.metadata?.sha256 !== fallbackModel
              ) {
                throw new Error(
                  `custom GGUF switch did not select the fallback entry: ${JSON.stringify(
                    {
                      mode: switched.mode,
                      selected: switched.customModel.metadata?.sha256,
                    },
                  )}`,
                );
              }
              const reactivated = await window.engram.activateGguf(activeModel);
              if (!reactivated.ok) {
                throw new Error(
                  reactivated.error ?? "custom GGUF reactivation failed",
                );
              }
              const activeAgain = await window.engram.getSettings();
              if (
                activeAgain.mode !== "custom" ||
                activeAgain.customModel.metadata?.sha256 !== activeModel
              ) {
                throw new Error(
                  `custom GGUF reactivation did not select the active entry: ${JSON.stringify(
                    {
                      mode: activeAgain.mode,
                      selected: activeAgain.customModel.metadata?.sha256,
                    },
                  )}`,
                );
              }
              const removed = await window.engram.removeGguf(activeModel);
              if (!removed.ok) {
                throw new Error(
                  removed.error ?? "active custom GGUF removal failed",
                );
              }
              const value = await window.engram.getSettings();
              return {
                mode: value.mode,
                status: value.customModel.status,
                fingerprint: value.customModel.metadata?.sha256,
                customModels: value.customModels.map((model) => ({
                  status: model.status,
                  fingerprint: model.metadata?.sha256,
                })),
              };
            },
            {
              fallbackModel: fallbackFingerprint,
              activeModel: customStatus.fingerprint,
            },
          )
        : await customRestartedSettings.evaluate(async () => {
            const result = await window.engram.removeGguf();
            if (!result.ok)
              throw new Error(result.error ?? "custom GGUF removal failed");
            const value = await window.engram.getSettings();
            return {
              mode: value.mode,
              status: value.customModel.status,
            };
          });
      if (
        multiModelSmoke
          ? (!["bundled", "offline"].includes(removedCustom.mode) ||
              removedCustom.fingerprint !== fallbackFingerprint ||
              removedCustom.customModels.length !== 1 ||
              removedCustom.customModels[0]?.fingerprint !== fallbackFingerprint)
          : removedCustom.status !== "none"
      ) {
        throw new Error(
          `custom GGUF fallback state was not safe after active removal: ${JSON.stringify(
            removedCustom,
          )}`,
        );
      }
      const afterRemoveEntries = readdirSync(customStorePath);
      const remainingGgufEntries = afterRemoveEntries.filter((entry) =>
        entry.endsWith(".gguf"),
      );
      if (
        remainingGgufEntries.some(
          (entry) =>
            !multiModelSmoke ||
            entry !== `${fallbackFingerprint}.gguf`,
        ) ||
        (!multiModelSmoke && remainingGgufEntries.length > 0) ||
        (multiModelSmoke &&
          (remainingGgufEntries.length !== 1 ||
            remainingGgufEntries[0] !== `${fallbackFingerprint}.gguf`)) ||
        afterRemoveEntries.some((entry) => entry.endsWith(".partial"))
      ) {
        throw new Error(
          `custom GGUF files remained after removal: ${JSON.stringify(afterRemoveEntries)}`,
        );
      }
      log(
        multiModelSmoke
          ? "switched managed GGUFs and removed the active entry without deleting the safe fallback"
          : "custom GGUF was removed through the packaged Settings IPC surface",
      );

      const cancelledStatus = await customRestartedSettings.evaluate(
        async () => {
          const downloadStarted = new Promise((resolve) => {
            const unsubscribe = window.engram.onOfflineModelStatus((status) => {
              if (status.state === "downloading") {
                unsubscribe();
                resolve(status);
              }
            });
          });
          const result = await window.engram.downloadOfflineModel();
          if (!result.ok || !result.operationId) {
            throw new Error(
              result.error ?? "offline-model cancellation download failed",
            );
          }
          await downloadStarted;
          const cancelled = await window.engram.cancelOfflineModelDownload(
            result.operationId,
          );
          if (!cancelled.ok) {
            throw new Error(
              cancelled.error ?? "offline-model cancellation failed",
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
          return { operationId: result.operationId, cancelled: true };
        },
      );
      if (!cancelledStatus.cancelled) {
        throw new Error(
          `offline model cancellation was not acknowledged: ${JSON.stringify(cancelledStatus)}`,
        );
      }
      log("offline model cancellation was acknowledged through IPC");

      await customRestartedSettings.evaluate(async () => {
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const result = await window.engram.downloadOfflineModel();
          if (result.ok) return;
          if (!result.error?.toLowerCase().includes("already running")) {
            throw new Error(result.error ?? "offline-model download failed");
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error(
          "offline-model retry remained blocked by the cancelled operation",
        );
      });
      downloadedStatus = await customRestartedSettings.evaluate(
        async (expectedStatus) => {
          const deadline = Date.now() + 60_000;
          let latest;
          while (Date.now() < deadline) {
            const value = await window.engram.getSettings();
            latest = {
              mode: value.mode,
              status: value.offlineModel.status,
              downloadedBytes: value.offlineModel.downloadedBytes,
              error: value.offlineModel.error,
              storageLocation: value.offlineModel.storageLocation,
            };
            if (value.offlineModel.status === expectedStatus) return latest;
            await new Promise((resolve) => setTimeout(resolve, 100));
          }
          throw new Error(
            `offline-model activation phase failed: downloaded model did not become ${expectedStatus}: ${JSON.stringify(latest)}`,
          );
        },
        expectedOfflineStatus,
      );
      if (
        downloadedStatus.mode !== "bundled" ||
        downloadedStatus.status !== expectedOfflineStatus
      ) {
        throw new Error(
          `offline-model activation phase failed: expected ${expectedOfflineStatus} in userData, got ${JSON.stringify(downloadedStatus)}`,
        );
      }
      if (
        downloadedStatus.downloadedBytes !== offlineFixture.bytes ||
        typeof downloadedStatus.storageLocation !== "string" ||
        !downloadedStatus.storageLocation.includes(userDataDir)
      ) {
        throw new Error(
          `offline-model verification phase failed: downloaded bytes or storage path was incorrect: ${JSON.stringify(downloadedStatus)}`,
        );
      }
      if (
        !existsSync(offlineModelPath) ||
        existsSync(offlineModelPartialPath)
      ) {
        throw new Error(
          `offline-model write-permission phase failed: model was not fully materialized in Electron userData: ${JSON.stringify(
            {
              offlineModelPath,
              finalExists: existsSync(offlineModelPath),
              partialExists: existsSync(offlineModelPartialPath),
            },
          )}`,
        );
      }
      if (useHttpsRedirectFixture && offlineFixture.redirectCount < 1) {
        throw new Error(
          "offline-model redirect phase failed: Windows HTTPS smoke did not traverse its redirect",
        );
      }
      diagnostics.userData.checkpoints.push({
        phase: "downloaded",
        status: downloadedStatus.status,
        downloadedBytes: downloadedStatus.downloadedBytes,
        storageLocation: downloadedStatus.storageLocation,
        finalExists: existsSync(offlineModelPath),
        partialExists: existsSync(offlineModelPartialPath),
      });
      diagnostics.fixture.redirectCount = offlineFixture.redirectCount;
      diagnostics.fixture.requestSequence = offlineFixture.requestSequence();
      markPhase("activation", { status: downloadedStatus.status });
      markPhase("verification", {
        downloadedBytes: downloadedStatus.downloadedBytes,
        sha256: offlineFixture.sha256,
      });
      markPhase("write-permission", {
        finalExists: existsSync(offlineModelPath),
        partialExists: existsSync(offlineModelPartialPath),
      });
      if (useHttpsRedirectFixture) {
        markPhase("redirect", {
          count: offlineFixture.redirectCount,
          traversed: offlineFixture.redirectCount > 0,
        });
      }
      log(
        `offline model downloaded, verified, and stored below Electron userData (${expectedOfflineStatus} on this package)`,
      );
    } finally {
      try {
        await customRestartedApp.close();
      } catch {
        const proc = customRestartedApp.process();
        if (proc && !proc.killed) proc.kill("SIGKILL");
      }
    }
    log(
      "simulated version A shutdown completed with the model still in userData",
    );

    const failedUpgradeApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        ...offlineModelFixtureEnv,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_UPGRADE_FAIL_START: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "B-failed",
        ENGRAM_SMOKE_DIAGNOSTICS_DIR: smokeDiagnosticsDir,
      },
    });
    await new Promise((resolve, reject) => {
      const process = failedUpgradeApp.process();
      if (!process) {
        reject(new Error("failed upgrade smoke process was unavailable"));
        return;
      }
      process.once("error", reject);
      process.once("exit", resolve);
    });
    log(
      "simulated failed version B exited without removing the userData model",
    );

    const upgradedApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        ...offlineModelFixtureEnv,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "B",
        ENGRAM_SMOKE_DIAGNOSTICS_DIR: smokeDiagnosticsDir,
      },
    });

    let upgradedSettings;
    try {
      const upgradedWindow = await upgradedApp.firstWindow({
        timeout: LAUNCH_TIMEOUT_MS,
      });
      await upgradedWindow.waitForLoadState("domcontentloaded");
      await upgradedWindow.waitForFunction(
        () => {
          const root = document.querySelector("#root");
          return !!root && root.children.length > 0;
        },
        undefined,
        { timeout: RENDER_TIMEOUT_MS },
      );
      const upgradedHealth = await upgradedWindow.evaluate(async () => {
        const res = await fetch("/api/healthz");
        return { status: res.status, body: await res.text() };
      });
      if (upgradedHealth.status !== 200) {
        throw new Error(
          `version B /api/healthz returned ${upgradedHealth.status} (body: ${upgradedHealth.body})`,
        );
      }

      const upgradedSettingsPromise = upgradedApp
        .waitForEvent("window", { timeout: 5_000 })
        .catch(() => null);
      await upgradedWindow.keyboard.press(
        process.platform === "darwin" ? "Meta+," : "Control+,",
      );
      upgradedSettings =
        (await upgradedSettingsPromise) ??
        upgradedApp.windows().find((candidate) => candidate !== upgradedWindow);
      if (!upgradedSettings) {
        throw new Error("version B Settings window did not open.");
      }
      await upgradedSettings.waitForLoadState("domcontentloaded");
      const persistedStatus = await upgradedSettings.evaluate(async () => {
        const value = await window.engram.getSettings();
        return {
          mode: value.mode,
          status: value.offlineModel.status,
          downloadedBytes: value.offlineModel.downloadedBytes,
          storageLocation: value.offlineModel.storageLocation,
        };
      });
      if (
        persistedStatus.mode !== "bundled" ||
        persistedStatus.status !== expectedOfflineStatus ||
        persistedStatus.downloadedBytes !== offlineFixture.bytes ||
        persistedStatus.storageLocation !== downloadedStatus.storageLocation
      ) {
        throw new Error(
          `version B did not preserve the verified userData model: ${JSON.stringify(persistedStatus)}`,
        );
      }
      log(
        "simulated version B preserved the verified active model and userData path",
      );

      const removedStatus = await upgradedSettings.evaluate(async () => {
        let result;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          result = await window.engram.removeOfflineModel();
          if (result.ok) break;
          if (!result.error?.toLowerCase().includes("download to finish")) {
            throw new Error(result.error ?? "offline-model removal failed");
          }
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!result?.ok) {
          throw new Error(
            result?.error ?? "offline-model removal remained blocked",
          );
        }
        const deadline = Date.now() + 30_000;
        while (Date.now() < deadline) {
          const value = await window.engram.getSettings();
          if (value.offlineModel.status !== "active") {
            return {
              mode: value.mode,
              status: value.offlineModel.status,
              downloadedBytes: value.offlineModel.downloadedBytes,
            };
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error("removed offline model remained active");
      });
      if (
        removedStatus.status === "active" ||
        removedStatus.downloadedBytes !== 0
      ) {
        throw new Error(
          `offline-model removal phase failed: status was not cleared: ${JSON.stringify(removedStatus)}`,
        );
      }
      if (existsSync(offlineModelPath) || existsSync(offlineModelPartialPath)) {
        throw new Error(
          `offline-model removal phase failed: files remained in Electron userData: ${JSON.stringify(
            {
              offlineModelPath,
              finalExists: existsSync(offlineModelPath),
              partialExists: existsSync(offlineModelPartialPath),
            },
          )}`,
        );
      }
      diagnostics.userData.checkpoints.push({
        phase: "removed",
        status: removedStatus.status,
        downloadedBytes: removedStatus.downloadedBytes,
        finalExists: existsSync(offlineModelPath),
        partialExists: existsSync(offlineModelPartialPath),
      });
      markPhase("removal", {
        status: removedStatus.status,
        finalExists: existsSync(offlineModelPath),
        partialExists: existsSync(offlineModelPartialPath),
      });
      log("offline model cancellation-safe lifecycle completed through IPC");
      if (process.env.ENGRAM_PACKAGED_UPDATE_SMOKE === "1") {
        await runPackagedUpdateSmoke(
          upgradedSettings,
          `${new URL(upgradedWindow.url()).origin}/api/healthz`,
          smokeDiagnosticsDir,
        );
      }
    } finally {
      try {
        await upgradedApp.close();
      } catch {
        const proc = upgradedApp.process();
        if (proc && !proc.killed) proc.kill("SIGKILL");
      }
    }
    if (
      process.platform === "linux" &&
      process.env.ENGRAM_PACKAGED_UPDATE_FEED_SMOKE === "1"
    ) {
      const disposableUpdateFeed = await serveDisposableUpdateFeed(
        smokeDiagnosticsDir,
      );
      try {
        await runDisposableUpdateFeedSmoke(
          exe,
          args,
          {
            ...process.env,
            ...offlineModelFixtureEnv,
            CI: "true",
            GITHUB_ACTIONS: "true",
            ENGRAM_PACKAGED_GGUF_SMOKE: "1",
            ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
            ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
            ENGRAM_PACKAGED_UPGRADE_STAGE: "disposable-update-feed",
            ENGRAM_SMOKE_DIAGNOSTICS_DIR: smokeDiagnosticsDir,
          },
          disposableUpdateFeed,
        );
      } finally {
        await disposableUpdateFeed.close();
      }
    }
    log(
      "PASS: packaged app launches, server is healthy, dashboard, custom GGUF, offline-model, and simulated upgrade paths load",
    );
  } finally {
    try {
      await app.close();
    } catch {
      const proc = app.process();
      if (proc && !proc.killed) proc.kill("SIGKILL");
    }
  }
  } catch (error) {
    const message = String(error?.stack ?? error);
    diagnostics.failure = {
      category: classifySmokeFailure(message),
      message: sanitizeSmokeText(message),
    };
    throw error;
  } finally {
    if (offlineFixture) {
      diagnostics.fixture.redirectCount = offlineFixture.redirectCount;
      diagnostics.fixture.requestSequence = offlineFixture.requestSequence();
      try {
        await new Promise((resolve) => offlineFixture.server.close(resolve));
      } catch (error) {
        diagnostics.failure ??= {
          category: "other",
          message: sanitizeSmokeText(
            `offline-model fixture cleanup failed: ${String(error)}`,
          ),
        };
      }
    }
    diagnostics.userData.final = {
      root: userDataDir,
      offlineModelPath,
      offlineModelPartialPath,
      finalExists: existsSync(offlineModelPath),
      partialExists: existsSync(offlineModelPartialPath),
    };
    writeSmokeDiagnostics();
    activeOfflineFixture = null;
    activeSmokeDiagnostics = null;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => fail(String(error?.stack ?? error)));
