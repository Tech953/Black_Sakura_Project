import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright-core";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const engramRoot = resolve(scriptDir, "../../engram");
const fixturePath =
  "/scripts/fixtures/desktop-update-banner-accessibility.html";

function findChromium() {
  return (
    process.env.CHROMIUM_PATH ??
    ["/repl/tools/bin/chromium", "chromium", "chromium-browser", "google-chrome"]
      .map((candidate) => {
        if (candidate.startsWith("/") && spawnSync("test", ["-x", candidate]).status === 0) {
          return candidate;
        }
        const result = spawnSync("which", [candidate], { encoding: "utf8" });
        return result.status === 0 ? result.stdout.trim() : "";
      })
      .find(Boolean)
  );
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not reserve a local test port");
  }
  await new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => (error ? rejectPromise(error) : resolvePromise()));
  });
  return address.port;
}

async function waitForVite(url, processRef, getOutput) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processRef.exitCode !== null) {
      throw new Error(`Vite exited before serving the fixture:\n${getOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await delay(100);
  }
  throw new Error(`Vite did not serve the fixture:\n${getOutput()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    delay(2_000),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

const chromiumPath = findChromium();
if (!chromiumPath) {
  throw new Error("Could not find Chromium. Set CHROMIUM_PATH or install Chromium.");
}

let vite;
let browser;
let viteOutput = "";

try {
  const port = await reservePort();
  const viteEnv = { ...process.env, BASE_PATH: "/", PORT: String(port) };
  delete viteEnv.REPL_ID;
  vite = spawn(
    "pnpm",
    [
      "exec",
      "vite",
      "--config",
      "vite.config.ts",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: engramRoot, env: viteEnv, stdio: ["ignore", "pipe", "pipe"] },
  );
  const captureViteOutput = (chunk) => {
    viteOutput = `${viteOutput}${chunk.toString()}`.slice(-6000);
  };
  vite.stdout.on("data", captureViteOutput);
  vite.stderr.on("data", captureViteOutput);

  const fixtureUrl = `http://127.0.0.1:${port}${fixturePath}`;
  await waitForVite(fixtureUrl, vite, () => viteOutput);

  browser = await chromium.launch({
    executablePath: chromiumPath,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.__desktopUpdateBannerFixture?.subscriberCount === 1,
    null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(50);

  const emit = (status) =>
    page.evaluate(
      (nextStatus) =>
        window.__desktopUpdateBannerFixture?.emit(nextStatus),
      status,
    );
  const waitForState = (state) =>
    page.waitForFunction(
      (expectedState) =>
        document.querySelector(
          `[data-testid="desktop-update-banner"][data-update-state="${expectedState}"]`,
        ) !== null,
      state,
      { timeout: 5_000 },
    );
  const readAnnouncement = () =>
    page.locator("#desktop-update-status").evaluate((node) => ({
      role: node.getAttribute("role"),
      live: node.getAttribute("aria-live"),
      atomic: node.getAttribute("aria-atomic"),
      describedBy: node.getAttribute("aria-describedby"),
      text: node.textContent?.trim() ?? "",
    }));

  for (const silentStatus of [
    { state: "checking" },
    { state: "not-available", manual: false },
  ]) {
    await emit(silentStatus);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-testid="desktop-update-banner"]') ===
          null &&
        document.querySelector('[role="status"], [role="alert"]') === null,
      null,
      { timeout: 3_000 },
    );
  }

  await page.locator("#dashboard-control").focus();
  await emit({ state: "downloaded", version: "1.2.3" });
  await waitForState("downloaded");
  let announcement = await readAnnouncement();
  assert(
    announcement.role === "status" &&
      announcement.live === "polite" &&
      announcement.atomic === "true",
    `Ready notice announcement semantics were incorrect: ${JSON.stringify(announcement)}`,
  );
  assert(
    (await page.locator('[role="progressbar"]').count()) === 0,
    "Ready notice unexpectedly retained a progressbar",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="desktop-update-banner"]') ===
        null &&
      document.activeElement?.id === "dashboard-control",
    null,
    { timeout: 3_000 },
  );

  await emit({ state: "checking", manual: true });
  await waitForState("checking");
  announcement = await readAnnouncement();
  assert(
    announcement.role === "status" &&
      announcement.live === "polite" &&
      announcement.text.length > 0,
    `Manual checking notice was not a polite status: ${JSON.stringify(announcement)}`,
  );

  await emit({ state: "not-available", manual: true });
  await waitForState("not-available");
  announcement = await readAnnouncement();
  assert(
    announcement.role === "status" &&
      announcement.live === "polite" &&
      announcement.text.includes("up to date"),
    `Manual up-to-date notice was not announced: ${JSON.stringify(announcement)}`,
  );

  await emit({ state: "available", version: "1.2.4" });
  await waitForState("available");
  announcement = await readAnnouncement();
  assert(
    announcement.role === "status" && announcement.live === "polite",
    `Available notice was not polite: ${JSON.stringify(announcement)}`,
  );
  const initialProgress = await page
    .locator('[role="progressbar"]')
    .evaluate((node) => ({
      min: node.getAttribute("aria-valuemin"),
      max: node.getAttribute("aria-valuemax"),
      now: Number(node.getAttribute("aria-valuenow")),
      valueText: node.getAttribute("aria-valuetext"),
    }));
  assert(
    initialProgress.min === "0" &&
      initialProgress.max === "100" &&
      initialProgress.now === 0 &&
      initialProgress.valueText === "Download starting",
    `Starting progressbar attributes were incorrect: ${JSON.stringify(initialProgress)}`,
  );

  async function expectProgress(percent, expected) {
    await emit({ state: "downloading", percent });
    await page.waitForFunction(
      (expectedValue) =>
        document
          .querySelector('[role="progressbar"]')
          ?.getAttribute("aria-valuenow") === String(expectedValue),
      expected,
      { timeout: 3_000 },
    );
    const progress = await page.locator('[role="progressbar"]').evaluate((node) => ({
      min: node.getAttribute("aria-valuemin"),
      max: node.getAttribute("aria-valuemax"),
      now: Number(node.getAttribute("aria-valuenow")),
      valueText: node.getAttribute("aria-valuetext"),
    }));
    assert(
      progress.min === "0" &&
        progress.max === "100" &&
        progress.now >= 0 &&
        progress.now <= 100 &&
        progress.valueText === `${expected}% downloaded`,
      `Progressbar exposed an invalid value: ${JSON.stringify(progress)}`,
    );
    announcement = await readAnnouncement();
    assert(
      announcement.role === null && announcement.live === "off",
      `Download progress tick was announced noisily: ${JSON.stringify(announcement)}`,
    );
    return progress;
  }

  const progressValues = [
    await expectProgress(-12, 0),
    await expectProgress(42.6, 43),
    await expectProgress(140, 100),
    await expectProgress(Number.NaN, 0),
    await expectProgress(Number.POSITIVE_INFINITY, 100),
    await expectProgress(Number.NEGATIVE_INFINITY, 0),
  ];

  await emit({ state: "error", message: "Update feed unavailable" });
  await waitForState("error");
  announcement = await readAnnouncement();
  assert(
    announcement.role === "alert" &&
      announcement.live === "assertive" &&
      announcement.atomic === "true" &&
      announcement.describedBy === "desktop-update-error" &&
      (await page.locator("#desktop-update-error").textContent())?.includes(
        "Update feed unavailable",
      ),
    `Error notice did not expose an assertive announcement: ${JSON.stringify(announcement)}`,
  );

  assert(pageErrors.length === 0, `Browser errors: ${pageErrors.join("; ")}`);
  console.log(
    `[update-banner-accessibility] PASS: live-region states, silent background checks, progress values ${progressValues.map((value) => value.now).join("/")}, Escape dismissal, and focus return`,
  );
} finally {
  await browser?.close();
  await stopProcess(vite);
}
