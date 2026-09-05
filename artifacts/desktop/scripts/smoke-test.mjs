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
  const ggufFixture = process.env.ENGRAM_PACKAGED_GGUF_FIXTURE;
  if (!ggufFixture || !path.isAbsolute(ggufFixture) || !existsSync(ggufFixture)) {
    fail(
      "a real compatible GGUF fixture is required; set " +
        "ENGRAM_PACKAGED_GGUF_FIXTURE to a downloaded test model",
    );
  }
  if (path.resolve(ggufFixture).startsWith(`${path.resolve(resources)}${path.sep}`)) {
    fail("the GGUF smoke fixture must not be staged inside installer resources");
  }
  const ggufHeader = readFileSync(ggufFixture).subarray(0, 8);
  if (
    ggufHeader.length !== 8 ||
    ggufHeader.toString("ascii", 0, 4) !== "GGUF" ||
    ggufHeader.readUInt32LE(4) < 1 ||
    ggufHeader.readUInt32LE(4) > 3
  ) {
    fail(`invalid GGUF smoke fixture: ${ggufFixture}`);
  }
  const offlineFixture = await serveOfflineModelFixture(
    createOfflineModelFixture(userDataDir),
  );
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
      ENGRAM_PACKAGED_GGUF_REAL_RUNTIME: "1",
      ENGRAM_PACKAGED_UPGRADE_STAGE: "A",
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
    let window = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    let url;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await window.waitForLoadState("domcontentloaded");
      url = window.url();
      if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) break;
      const loopbackWindow = app
        .windows()
        .find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\//.test(candidate.url()));
      if (loopbackWindow) {
        window = loopbackWindow;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(window.url())) {
      throw new Error(`unexpected window URL (expected loopback): ${window.url()}`);
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
    await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    const settings =
      (await settingsPromise) ??
      app.windows().find((candidate) => candidate !== window);
    if (!settings) {
      throw new Error("Settings window did not open from the application menu.");
    }
    await settings.waitForLoadState("domcontentloaded");
    const customImport = await settings.evaluate(async (sourcePath) => {
      const selection = await window.engram.chooseGguf();
      if (!selection.ok) {
        throw new Error(selection.error ?? "native GGUF picker failed");
      }
      const selectionPayload = JSON.stringify(selection.selection);
      if (selectionPayload.includes(sourcePath)) {
        throw new Error("GGUF source path leaked into the renderer selection payload");
      }
      if (
        selection.selection.filename !== "SmolLM2-135M-Instruct-Q4_K_M.gguf" ||
        selection.selection.byteSize < 1_000_000 ||
        selection.selection.ggufVersion < 1 ||
        selection.selection.ggufVersion > 3
      ) {
        throw new Error(`unexpected native GGUF selection: ${selectionPayload}`);
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
      const unsubscribeCancelled = window.engram.onGgufImportStatus((status) => {
        cancelledStates.push(status.state);
        if (status.state === "copying" && !cancelRequested) {
          cancelRequested = true;
          void window.engram.cancelGgufImport(status.operationId)
            .catch((error) => {
              cancelError = String(error);
              rejectCancelled(error);
            });
        }
        if (status.state === "cancelled" || status.state === "error") {
          resolveCancelled(status);
        }
      });
      const cancelledImport = await window.engram.importGguf(selection.selection.selectionId);
      if (!cancelledImport.ok || !cancelledImport.operationId) {
        unsubscribeCancelled();
        throw new Error(cancelledImport.error ?? "GGUF cancellation import did not start");
      }
      const cancelledStatus = await cancelledDone;
      unsubscribeCancelled();
      if (cancelError || cancelledStatus.state !== "cancelled" || !cancelRequested) {
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
        throw new Error(secondSelection.error ?? "native GGUF picker retry failed");
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
          rejectImported(new Error(status.error ?? `GGUF import ${status.state}`));
        }
      });
      const imported = await window.engram.importGguf(secondSelection.selection.selectionId);
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
        mode: value.mode,
      };
    }, ggufFixture);
    const customStatus = {
      mode: customImport.mode,
      status: customImport.customModel.status,
      fingerprint: customImport.customModel.metadata?.sha256,
    };
    if (
      !customImport.cancelledStates.includes("copying") ||
      !customImport.cancelledStates.includes("cancelled") ||
      !customImport.importStates.includes("copying") ||
      !customImport.importStates.includes("activating") ||
      !customImport.importStates.includes("completed")
    ) {
      throw new Error(`custom GGUF progress journey was incomplete: ${JSON.stringify(customImport)}`);
    }
    if (
      customStatus.mode !== "custom" ||
      customStatus.status !== "active" ||
      !/^[a-f0-9]{64}$/.test(customStatus.fingerprint ?? "")
    ) {
      throw new Error(`custom GGUF import/selection/launch was not active: ${JSON.stringify(customStatus)}`);
    }
    const customStorePath = path.join(userDataDir, "models", "custom");
    const customEntries = readdirSync(customStorePath);
    if (
      customEntries.some((entry) => entry.endsWith(".partial")) ||
      !customEntries.includes(`${customStatus.fingerprint}.gguf`)
    ) {
      throw new Error(`custom GGUF store was not transactional: ${JSON.stringify(customEntries)}`);
    }
    log("custom GGUF picker, progress, cancellation, activation, and launch path active");

    await app.close();
    log("custom GGUF persisted after shutdown");

    const customRestartedApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
        ENGRAM_PACKAGED_GGUF_REAL_RUNTIME: "1",
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "custom-restart",
        ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE: "1",
        ENGRAM_PACKAGED_OFFLINE_MODEL_URL: offlineFixture.url,
        ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES: String(offlineFixture.bytes),
        ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256: offlineFixture.sha256,
      },
    });
    let customRestartedSettings;
    const expectedOfflineStatus = process.env.EXPECT_SLIM_LLM === "1" ? "active" : "available";
    let downloadedStatus;
    try {
      const restartedWindow = await customRestartedApp.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
      await restartedWindow.waitForLoadState("domcontentloaded");
      const restartedSettingsPromise = customRestartedApp
        .waitForEvent("window", { timeout: 5_000 })
        .catch(() => null);
      await restartedWindow.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
      customRestartedSettings =
        (await restartedSettingsPromise) ??
        customRestartedApp.windows().find((candidate) => candidate !== restartedWindow);
      if (!customRestartedSettings) {
        throw new Error("Settings window did not open after custom GGUF restart.");
      }
      await customRestartedSettings.waitForLoadState("domcontentloaded");
      const persistedCustom = await customRestartedSettings.evaluate(async () => {
        const value = await window.engram.getSettings();
        return {
          mode: value.mode,
          status: value.customModel.status,
          fingerprint: value.customModel.metadata?.sha256,
        };
      });
      if (
        persistedCustom.mode !== "custom" ||
        persistedCustom.status !== "active" ||
        persistedCustom.fingerprint !== customStatus.fingerprint
      ) {
        throw new Error(`custom GGUF was not active after restart: ${JSON.stringify(persistedCustom)}`);
      }
      log("custom GGUF survived restart and was re-verified by the packaged runtime");

      const removedCustom = await customRestartedSettings.evaluate(async () => {
        const result = await window.engram.removeGguf();
        if (!result.ok) throw new Error(result.error ?? "custom GGUF removal failed");
        const value = await window.engram.getSettings();
        return {
          mode: value.mode,
          status: value.customModel.status,
        };
      });
      if (removedCustom.status !== "none") {
        throw new Error(`custom GGUF remained after removal: ${JSON.stringify(removedCustom)}`);
      }
      const afterRemoveEntries = readdirSync(customStorePath);
      if (afterRemoveEntries.some((entry) => entry.endsWith(".gguf") || entry.endsWith(".partial"))) {
        throw new Error(`custom GGUF files remained after removal: ${JSON.stringify(afterRemoveEntries)}`);
      }
      log("custom GGUF was removed through the packaged Settings IPC surface");

      const cancelledStatus = await customRestartedSettings.evaluate(async () => {
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
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { operationId: result.operationId, cancelled: true };
      });
      if (!cancelledStatus.cancelled) {
        throw new Error(`offline model cancellation was not acknowledged: ${JSON.stringify(cancelledStatus)}`);
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
        throw new Error("offline-model retry remained blocked by the cancelled operation");
      });
      downloadedStatus = await customRestartedSettings.evaluate(async (expectedStatus) => {
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
          `downloaded offline model did not become ${expectedStatus}: ${JSON.stringify(latest)}`,
        );
      }, expectedOfflineStatus);
      if (
        downloadedStatus.mode !== "bundled" ||
        downloadedStatus.status !== expectedOfflineStatus ||
        downloadedStatus.downloadedBytes !== offlineFixture.bytes ||
        !downloadedStatus.storageLocation.includes(userDataDir)
      ) {
        throw new Error(
          `offline model download/activation was not ${expectedOfflineStatus} in userData: ${JSON.stringify(downloadedStatus)}`,
        );
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
    log("simulated version A shutdown completed with the model still in userData");

    const failedUpgradeApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_UPGRADE_FAIL_START: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "B-failed",
        ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE: "1",
        ENGRAM_PACKAGED_OFFLINE_MODEL_URL: offlineFixture.url,
        ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES: String(offlineFixture.bytes),
        ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256: offlineFixture.sha256,
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
    log("simulated failed version B exited without removing the userData model");

    const upgradedApp = await electron.launch({
      executablePath: exe,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env: {
        ...process.env,
        CI: "true",
        GITHUB_ACTIONS: "true",
        ENGRAM_PACKAGED_GGUF_SMOKE: "1",
        ENGRAM_PACKAGED_GGUF_SMOKE_SKIP_PREPARE: "1",
        ENGRAM_PACKAGED_GGUF_FIXTURE: ggufFixture,
        ENGRAM_PACKAGED_UPGRADE_STAGE: "B",
        ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE: "1",
        ENGRAM_PACKAGED_OFFLINE_MODEL_URL: offlineFixture.url,
        ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES: String(offlineFixture.bytes),
        ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256: offlineFixture.sha256,
      },
    });

    let upgradedSettings;
    try {
      const upgradedWindow = await upgradedApp.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
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
      await upgradedWindow.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
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
      log("simulated version B preserved the verified active model and userData path");

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
    } finally {
      try {
        await upgradedApp.close();
      } catch {
        const proc = upgradedApp.process();
        if (proc && !proc.killed) proc.kill("SIGKILL");
      }
    }
    log("PASS: packaged app launches, server is healthy, dashboard, custom GGUF, offline-model, and simulated upgrade paths load");
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
