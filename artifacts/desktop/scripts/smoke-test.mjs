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
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, ".."); // artifacts/desktop
const releaseDir = path.join(desktopDir, "release");

const LAUNCH_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 60_000;
const WATCHDOG_MS = 180_000;

function createTinyGgufFixture(directory) {
  // The store's production minimum is 1 MiB. This is only a valid container
  // header, never an inference-capable model; main.ts permits it exclusively
  // behind its CI-only packaged-smoke gate and replaces llama-server with a
  // loopback health stub after the real import/verification path completes.
  const fixture = path.join(directory, "packaged-smoke.gguf");
  const bytes = Buffer.alloc(1024 * 1024, 0);
  bytes.write("GGUF", 0, "ascii");
  bytes.writeUInt32LE(3, 4);
  writeFileSync(fixture, bytes, { mode: 0o600 });
  return fixture;
}

async function serveOfflineModelFixture(fixture) {
  const bytes = readFileSync(fixture);
  const server = createServer((req, res) => {
    if (req.url !== "/offline-model.gguf") {
      res.writeHead(404).end();
      return;
    }
    const range = req.headers.range;
    const match = range?.match(/^bytes=(\d+)-(\d*)$/);
    if (match) {
      const start = Number(match[1]);
      const requestedEnd = match[2] ? Number(match[2]) : bytes.length - 1;
      const end = Math.min(requestedEnd, bytes.length - 1);
      if (start >= bytes.length || end < start) {
        res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }).end();
        return;
      }
      res.writeHead(206, {
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Type": "application/octet-stream",
      });
      res.end(bytes.subarray(start, end + 1));
      return;
    }
    res.writeHead(200, {
      "Accept-Ranges": "bytes",
      "Content-Length": bytes.length,
      "Content-Type": "application/octet-stream",
    });
    res.end(bytes);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("offline-model fixture server did not expose a TCP address");
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}/offline-model.gguf`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
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
    return { dir, exe: pickExe(dir, "engram"), resources: path.join(dir, "resources") };
  }
  if (platform === "win32") {
    const dir = path.join(releaseDir, "win-unpacked");
    return { dir, exe: pickExe(dir, "engram.exe"), resources: path.join(dir, "resources") };
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
    return { dir: appDir, exe, resources: path.join(appDir, "Contents", "Resources") };
  }
  return fail(`unsupported platform: ${platform}`);
}

const { dir, exe, resources } = locate();

if (!exe || !existsSync(exe)) {
  fail(`packaged executable not found (looked under ${dir}). Did packaging run?`);
}
log(`packaged app: ${exe}`);

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
log("trusted llama.cpp runtime present for managed custom GGUFs");

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
  const ggufFixture = createTinyGgufFixture(userDataDir);
  const offlineFixture = await serveOfflineModelFixture(ggufFixture);
  const args = [`--user-data-dir=${userDataDir}`];
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
      CI: "true",
      GITHUB_ACTIONS: "true",
      ENGRAM_PACKAGED_GGUF_SMOKE: "1",
      ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
      ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE: "1",
      ENGRAM_PACKAGED_OFFLINE_MODEL_URL: offlineFixture.url,
      ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES: String(offlineFixture.bytes),
      ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256: offlineFixture.sha256,
    },
  });

  try {
    // The main window only opens after the embedded server becomes healthy
    // (startServer awaits waitForHealth before createMainWindow). If migrations,
    // seed, or pglite are broken, the server never goes healthy and no window
    // appears -> firstWindow times out -> this throws -> job fails.
    const window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    await window.waitForLoadState("domcontentloaded");

    const url = window.url();
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
      throw new Error(`unexpected window URL (expected loopback): ${url}`);
    }
    log(`window loaded: ${url}`);

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

    // The startup seam imported through CustomGgufStore, persisted the custom
    // selection, verified it immediately before launch, and started the
    // loopback fixture runtime. Assert the selected custom model is live from
    // the packaged Settings IPC surface as the final end-to-end proof.
    const settingsPromise = app
      .waitForEvent("window", { timeout: 5_000 })
      .catch(() => null);
    await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    const settings =
      (await settingsPromise) ??
      app.windows().find((candidate) => candidate !== window);
    if (!settings) {
      throw new Error("Settings window did not open from the application menu.");
    }
    await settings.waitForLoadState("domcontentloaded");
    const customStatus = await settings.evaluate(async () => {
      const value = await window.engram.getSettings();
      return {
        mode: value.mode,
        status: value.customModel.status,
        fingerprint: value.customModel.metadata?.sha256,
      };
    });
    if (
      customStatus.mode !== "custom" ||
      customStatus.status !== "active" ||
      !/^[a-f0-9]{64}$/.test(customStatus.fingerprint ?? "")
    ) {
      throw new Error(`custom GGUF import/selection/launch was not active: ${JSON.stringify(customStatus)}`);
    }
    log("custom GGUF import, selection, verification, and launch path active");

    const cancelledStatus = await settings.evaluate(async () => {
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
        throw new Error(result.error ?? "offline-model cancellation download failed");
      }
      await downloadStarted;
      const cancelled = await window.engram.cancelOfflineModelDownload(result.operationId);
      if (!cancelled.ok) {
        throw new Error(cancelled.error ?? "offline-model cancellation failed");
      }
      // The cancel IPC acknowledges the AbortController immediately; allow the
      // async downloader's finally block to release its operation slot before
      // the retry below.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { operationId: result.operationId, cancelled: true };
    });
    if (!cancelledStatus.cancelled) {
      throw new Error(`offline model cancellation was not acknowledged: ${JSON.stringify(cancelledStatus)}`);
    }
    log("offline model cancellation was acknowledged through IPC");

    await settings.evaluate(async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const result = await window.engram.downloadOfflineModel();
        if (result.ok) return;
        if (!result.error?.toLowerCase().includes("already running")) {
          throw new Error(result.error ?? "offline-model download failed");
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("offline-model retry remained blocked by the cancelled operation");
    });
    const downloadedStatus = await settings.evaluate(async () => {
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
        if (value.offlineModel.status === "active") {
          return latest;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`downloaded offline model did not become active: ${JSON.stringify(latest)}`);
    });
    if (
      downloadedStatus.mode !== "bundled" ||
      downloadedStatus.status !== "active" ||
      downloadedStatus.downloadedBytes !== offlineFixture.bytes ||
      !downloadedStatus.storageLocation.includes(userDataDir)
    ) {
      throw new Error(`offline model download/activation was not active in userData: ${JSON.stringify(downloadedStatus)}`);
    }
    log("offline model downloaded, verified, activated, and stored below Electron userData");

    const removedStatus = await settings.evaluate(async () => {
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
        throw new Error(result?.error ?? "offline-model removal remained blocked");
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
      throw new Error(`offline model removal was not complete: ${JSON.stringify(removedStatus)}`);
    }
    log("offline model cancellation-safe lifecycle completed through IPC");

    log("PASS: packaged app launches, server is healthy, dashboard, custom GGUF, and offline-model paths load");
  } finally {
    try {
      await app.close();
    } catch {
      const proc = app.process();
      if (proc && !proc.killed) proc.kill("SIGKILL");
    }
    await new Promise((resolve) => offlineFixture.server.close(resolve));
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => fail(String(error?.stack ?? error)));
