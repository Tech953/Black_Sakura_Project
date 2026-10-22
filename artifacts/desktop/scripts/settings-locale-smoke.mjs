import { _electron as electron } from "playwright-core";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const workspaceRoot = path.resolve(desktopDir, "..", "..");
const localeDir = path.join(workspaceRoot, "lib", "i18n", "src");
const LAUNCH_TIMEOUT_MS = 120_000;
const RENDER_TIMEOUT_MS = 30_000;

const englishUpdateCopy = JSON.parse(
  readFileSync(path.join(localeDir, "en", "settings.json"), "utf8"),
).update;

function readUpdateCopy(language) {
  if (language === "en") return englishUpdateCopy;
  const locale = JSON.parse(
    readFileSync(
      path.join(localeDir, "generated", `${language}.json`),
      "utf8",
    ),
  );
  return locale.settings.update;
}

function assert(condition, message) {
  if (!condition) throw new Error(`[settings-locale-smoke] ${message}`);
}

async function runCase({
  executablePath,
  baseArgs,
  baseEnv,
  scenario,
}) {
  const userDataDir = mkdtempSync(
    path.join(os.tmpdir(), "engram-settings-locale-"),
  );
  const diagnosticsDir = path.join(userDataDir, "diagnostics");
  mkdirSync(diagnosticsDir, { recursive: true });
  const storedSettings = { mode: "bundled" };
  if (scenario.storedLanguage !== undefined) {
    storedSettings.uiLanguage = scenario.storedLanguage;
  }
  writeFileSync(
    path.join(userDataDir, "settings.json"),
    `${JSON.stringify(storedSettings)}\n`,
    { mode: 0o600 },
  );

  const args = baseArgs.filter(
    (arg) =>
      !arg.startsWith("--user-data-dir=") &&
      !arg.startsWith("--lang="),
  );
  if (process.platform === "linux") {
    for (const flag of [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ]) {
      if (!args.includes(flag)) args.push(flag);
    }
  }
  args.push(
    `--user-data-dir=${userDataDir}`,
    `--lang=${scenario.systemLocale}`,
  );
  const env = {
    ...baseEnv,
    CI: "true",
    GITHUB_ACTIONS: "true",
    ENGRAM_PACKAGED_GGUF_SMOKE: "1",
    ENGRAM_PACKAGED_UPDATE_SMOKE: "1",
    ENGRAM_PACKAGED_UPDATE_FEED_URL: "",
    ENGRAM_PACKAGED_SETTINGS_LOCALE_SMOKE: "1",
    ENGRAM_SMOKE_DIAGNOSTICS_DIR: diagnosticsDir,
  };

  let app;
  try {
    app = await electron.launch({
      executablePath,
      args,
      timeout: LAUNCH_TIMEOUT_MS,
      env,
    });
    const settings = await app.firstWindow({ timeout: LAUNCH_TIMEOUT_MS });
    await settings.waitForURL(/settings\.html$/, {
      timeout: LAUNCH_TIMEOUT_MS,
    });
    await settings.waitForLoadState("domcontentloaded");

    const copy = readUpdateCopy(scenario.expectedLanguage);
    if (scenario.expectedLanguage !== "en") {
      for (const key of [
        "checking",
        "downloading",
        "checkForUpdates",
        "progressLabel",
      ]) {
        assert(
          copy[key] !== englishUpdateCopy[key],
          `${scenario.expectedLanguage} source copy unexpectedly matches English for ${key}`,
        );
      }
    }

    const expectedInitial = {
      language: scenario.expectedLanguage,
      status: copy.upToDate,
      button: copy.checkForUpdates,
      progressLabel: copy.progressLabel,
    };
    await settings.waitForFunction(
      (expected) =>
        document.documentElement.lang === expected.language &&
        document.querySelector("#update-status")?.textContent ===
          expected.status &&
        document.querySelector("#check-updates")?.textContent ===
          expected.button &&
        document
          .querySelector("#update-progress")
          ?.getAttribute("aria-label") === expected.progressLabel,
      expectedInitial,
      { timeout: RENDER_TIMEOUT_MS },
    );

    const initial = await settings.evaluate(async () => ({
      language: document.documentElement.lang,
      bridgeLanguage: await window.engram.getUiLanguage(),
      systemLanguage: navigator.language,
      status: document.querySelector("#update-status")?.textContent,
      button: document.querySelector("#check-updates")?.textContent,
      buttonDisabled: document.querySelector("#check-updates")?.disabled,
      progressLabel: document
        .querySelector("#update-progress")
        ?.getAttribute("aria-label"),
    }));
    const expectedBridgeLanguage =
      scenario.storedLanguage ?? "en";
    assert(
      initial.bridgeLanguage === expectedBridgeLanguage,
      `${scenario.name}: bridge returned ${initial.bridgeLanguage}, expected ${expectedBridgeLanguage}`,
    );
    assert(
      initial.language === scenario.expectedLanguage &&
        initial.status === copy.upToDate &&
        initial.button === copy.checkForUpdates &&
        initial.buttonDisabled === false &&
        initial.progressLabel === copy.progressLabel,
      `${scenario.name}: Settings did not use the expected locale copy: ${JSON.stringify(initial)}`,
    );

    const windowUrls = app.windows().map((window) => window.url());
    assert(
      windowUrls.length === 1 && /settings\.html$/.test(windowUrls[0]),
      `${scenario.name}: Settings was not the only window before dashboard startup: ${JSON.stringify(windowUrls)}`,
    );

    if (scenario.verifyUpdateEvents) {
      await settings.evaluate(() => {
        window.__settingsLocaleSmokeSnapshots = [];
        window.engram.onUpdateStatus((status) => {
          const progress = document.querySelector("#update-progress");
          const button = document.querySelector("#check-updates");
          window.__settingsLocaleSmokeSnapshots.push({
            state: status.state,
            statusText: document.querySelector("#update-status")?.textContent,
            buttonText: button?.textContent,
            buttonDisabled: button?.disabled,
            progressHidden: progress?.classList.contains("hidden"),
            progressValue: progress?.getAttribute("aria-valuenow"),
            progressLabel: progress?.getAttribute("aria-label"),
          });
        });
      });
      await settings.locator("#check-updates").click();
      await settings.waitForFunction(
        () =>
          window.__settingsLocaleSmokeSnapshots?.some(
            (snapshot) => snapshot.state === "downloaded",
          ),
        undefined,
        { timeout: RENDER_TIMEOUT_MS },
      );

      const snapshots = await settings.evaluate(
        () => window.__settingsLocaleSmokeSnapshots,
      );
      const states = snapshots.map((snapshot) => snapshot.state);
      const expectedStates = [
        "checking",
        "available",
        "downloading",
        "downloaded",
      ];
      let previousIndex = -1;
      for (const state of expectedStates) {
        const index = states.indexOf(state, previousIndex + 1);
        assert(
          index >= 0,
          `update event sequence omitted or reordered ${state}: ${JSON.stringify(states)}`,
        );
        previousIndex = index;
      }

      const expectedStatusText = {
        checking: copy.checking,
        available: copy.availableWithVersion.replace(
          "{{version}}",
          "0.0.0-smoke",
        ),
        downloading: copy.downloading.replace("{{percent}}", "100"),
        downloaded: copy.downloaded,
      };
      for (const state of expectedStates) {
        const snapshot = snapshots.find((entry) => entry.state === state);
        assert(
          snapshot.statusText === expectedStatusText[state] &&
            snapshot.buttonText === copy.checkForUpdates &&
            snapshot.progressLabel === copy.progressLabel,
          `${state} update event rendered the wrong locale copy: ${JSON.stringify(snapshot)}`,
        );
        assert(
          snapshot.buttonDisabled === (state !== "downloaded"),
          `${state} update event changed the existing button state: ${JSON.stringify(snapshot)}`,
        );
        assert(
          snapshot.progressHidden === (state !== "downloading"),
          `${state} update event changed the existing progress visibility: ${JSON.stringify(snapshot)}`,
        );
        if (state === "downloading") {
          assert(
            snapshot.progressValue === "100",
            `downloading event did not update the progress value: ${JSON.stringify(snapshot)}`,
          );
        }
      }
    }
  } finally {
    if (app) {
      try {
        await app.close();
      } catch {
        const proc = app.process();
        if (proc && !proc.killed) proc.kill("SIGKILL");
      }
    }
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

export async function runPackagedSettingsLocaleSmoke({
  executablePath,
  baseArgs,
  baseEnv,
}) {
  const scenarios = [
    {
      name: "saved non-English language",
      storedLanguage: "fr",
      systemLocale: "de-DE",
      expectedLanguage: "fr",
      verifyUpdateEvents: true,
    },
    {
      name: "missing saved language",
      systemLocale: "fr-FR",
      expectedLanguage: "en",
    },
    {
      name: "unsupported saved language",
      storedLanguage: "xx",
      systemLocale: "de-DE",
      expectedLanguage: "de",
    },
    {
      name: "unsupported saved and system languages",
      storedLanguage: "xx",
      systemLocale: "zz-ZZ",
      expectedLanguage: "en",
    },
  ];

  for (const scenario of scenarios) {
    console.log(`[settings-locale-smoke] checking ${scenario.name}`);
    await runCase({
      executablePath,
      baseArgs,
      baseEnv,
      scenario,
    });
  }
  console.log(
    "[settings-locale-smoke] PASS: saved, missing, and unsupported languages; packaged Settings opened before dashboard startup and updater events retained their behavior",
  );
}
