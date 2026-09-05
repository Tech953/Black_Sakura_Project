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
import { existsSync, readdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
    const settingsPromise = app.waitForEvent("window", { timeout: RENDER_TIMEOUT_MS });
    await window.keyboard.press(process.platform === "darwin" ? "Meta+," : "Control+,");
    const settings = await settingsPromise;
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

    log("PASS: packaged app launches, server is healthy, dashboard and custom GGUF path load");
  } finally {
    try {
      await app.close();
    } catch {
      const proc = app.process();
      if (proc && !proc.killed) proc.kill("SIGKILL");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => fail(String(error?.stack ?? error)));
