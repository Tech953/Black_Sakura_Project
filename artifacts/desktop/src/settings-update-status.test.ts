import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type FakeElement = {
  textContent: string;
  disabled: boolean;
  style: { width: string };
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  addEventListener: ReturnType<typeof vi.fn>;
  setAttribute: ReturnType<typeof vi.fn>;
};

type RenderUpdateStatus = (
  info: { updatesSupported: boolean },
  status: {
    state: string;
    message?: string;
    percent?: number;
    version?: string;
    transferred?: number;
    total?: number;
    bytesPerSecond?: number;
    deferred?: boolean;
    retryable?: boolean;
  },
  copy?: Record<string, string>,
) => void;

function createFakeElement(): FakeElement {
  return {
    textContent: "",
    disabled: false,
    style: { width: "" },
    classList: { add: vi.fn(), remove: vi.fn() },
    addEventListener: vi.fn(),
    setAttribute: vi.fn(),
  };
}

function loadRenderer(): {
  renderUpdateStatus: (
    info: { updatesSupported: boolean },
    status: {
      state: string;
      message?: string;
      percent?: number;
      version?: string;
      transferred?: number;
      total?: number;
      bytesPerSecond?: number;
      deferred?: boolean;
      retryable?: boolean;
    },
    copy?: Record<string, string>,
  ) => void;
  elements: Record<string, FakeElement>;
} {
  const html = readFileSync(
    new URL("./settings.html", import.meta.url),
    "utf8",
  );
  const start = html.indexOf("function renderUpdateStatus");
  const end = html.indexOf("async function initAbout", start);
  if (start < 0 || end < 0) throw new Error("renderUpdateStatus was not found");
  const source = html.slice(start, end);

  const elements: Record<string, FakeElement> = {
    "app-version": createFakeElement(),
    "update-status": createFakeElement(),
    "check-updates": createFakeElement(),
    "update-progress": createFakeElement(),
    "update-progress-fill": createFakeElement(),
    "update-progress-details": createFakeElement(),
    "update-recovery": createFakeElement(),
    "update-recovery-message": createFakeElement(),
    "retry-update": createFakeElement(),
    "open-release-page": createFakeElement(),
  };
  const dollar = (id: string): FakeElement => {
    const element = elements[id];
    if (!element) throw new Error(`Unknown fake element: ${id}`);
    return element;
  };
  const renderUpdateStatus = new Function(
    "$",
    `${source}; return renderUpdateStatus;`,
  )(dollar) as RenderUpdateStatus;

  return { renderUpdateStatus, elements };
}

function loadAboutInitializer(
  elements: Record<string, FakeElement>,
  renderUpdateStatus: RenderUpdateStatus,
  bridge: unknown,
  updateCopy: Record<string, string>,
): () => Promise<void> {
  const html = readFileSync(
    new URL("./settings.html", import.meta.url),
    "utf8",
  );
  const start = html.indexOf("async function initAbout()");
  const end = html.indexOf('\n      $("cancel")', start);
  if (start < 0 || end < 0) throw new Error("initAbout was not found");
  const source = html.slice(start, end);
  const dollar = (id: string): FakeElement => {
    const element = elements[id];
    if (!element) throw new Error(`Unknown fake element: ${id}`);
    return element;
  };

  return new Function(
    "$",
    "window",
    "renderUpdateStatus",
    "activeSettingsCopy",
    `${source}; return initAbout;`,
  )(
    dollar,
    { engram: bridge },
    renderUpdateStatus,
    { update: updateCopy },
  ) as () => Promise<void>;
}

describe("Settings update status renderer", () => {
  it("hydrates an active download before subscribing and applies live updates once", async () => {
    const { renderUpdateStatus: baseRenderUpdateStatus, elements } =
      loadRenderer();
    const updateCopy = {
      checkForUpdates: "Check for updates",
      progressLabel: "Update download progress",
      retryUpdate: "Retry update",
      downloadLatestRelease: "Download latest release",
      downloading: "Downloading update… {{percent}}%",
      downloadDetails: "{{transferred}} / {{total}} · {{speed}}",
    };
    const callOrder: string[] = [];
    const renderCalls: Parameters<RenderUpdateStatus>[] = [];
    const renderUpdateStatus: RenderUpdateStatus = (info, status, copy) => {
      callOrder.push(`render:${status.percent}`);
      renderCalls.push([info, status, copy]);
      baseRenderUpdateStatus(info, status, copy);
    };
    const hydratedStatus = {
      state: "downloading",
      percent: 24,
      transferred: 512 * 1024,
      total: 2 * 1024 * 1024,
      bytesPerSecond: 64 * 1024,
    };
    const appInfo = {
      version: "1.2.3",
      updatesSupported: true,
      updateStatus: hydratedStatus,
    };
    let updateListener:
      | ((status: Parameters<RenderUpdateStatus>[1]) => void)
      | undefined;
    const bridge = {
      getAppInfo: vi.fn(async () => {
        callOrder.push("app-info");
        return appInfo;
      }),
      onUpdateStatus: vi.fn(
        (callback: (status: Parameters<RenderUpdateStatus>[1]) => void) => {
          callOrder.push("subscribe");
          updateListener = callback;
          return vi.fn();
        },
      ),
      checkForUpdates: vi.fn(),
      openReleaseDownloadPage: vi.fn(async () => ({ ok: true })),
    };
    const initAbout = loadAboutInitializer(
      elements,
      renderUpdateStatus,
      bridge,
      updateCopy,
    );

    await initAbout();

    expect(callOrder).toEqual(["app-info", "render:24", "subscribe"]);
    expect(elements["app-version"].textContent).toBe("1.2.3");
    expect(elements["update-status"].textContent).toBe(
      "Downloading update… 24%",
    );
    expect(elements["update-progress-fill"].style.width).toBe("24%");
    expect(elements["update-progress"].classList.remove).toHaveBeenCalledTimes(
      1,
    );
    expect(elements["update-progress"].setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "24",
    );
    expect(elements["update-progress-details"].textContent).toBe(
      "512 KB / 2 MB · 64 KB/s",
    );
    expect(
      elements["update-progress-details"].classList.remove,
    ).toHaveBeenCalledTimes(1);
    expect(bridge.onUpdateStatus).toHaveBeenCalledTimes(1);

    const liveStatus = {
      state: "downloading",
      percent: 48,
      transferred: 1024 * 1024,
      total: 2 * 1024 * 1024,
      bytesPerSecond: 128 * 1024,
    };
    updateListener?.(liveStatus);

    expect(callOrder).toEqual([
      "app-info",
      "render:24",
      "subscribe",
      "render:48",
    ]);
    expect(renderCalls).toHaveLength(2);
    expect(renderCalls[0]?.[1]).toBe(hydratedStatus);
    expect(renderCalls[1]?.[1]).toBe(liveStatus);
    expect(elements["update-status"].textContent).toBe(
      "Downloading update… 48%",
    );
    expect(elements["update-progress-fill"].style.width).toBe("48%");
    expect(elements["update-progress"].classList.remove).toHaveBeenCalledTimes(
      2,
    );
    expect(elements["update-progress"].setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "48",
    );
    expect(elements["update-progress-details"].textContent).toBe(
      "1 MB / 2 MB · 128 KB/s",
    );
    expect(
      elements["update-progress-details"].classList.remove,
    ).toHaveBeenCalledTimes(2);
  });

  it("maps every updater state to its expected label", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const info = { updatesSupported: true };

    const cases = [
      [{ state: "idle" }, "Up to date"],
      [{ state: "checking" }, "Checking for updates…"],
      [
        { state: "available", version: "1.2.3" },
        "Update 1.2.3 found — downloading…",
      ],
      [{ state: "downloading", percent: 42 }, "Downloading update… 42%"],
      [{ state: "downloaded" }, "Restart to update"],
      [{ state: "error" }, "Update check failed"],
      [{ state: "not-available" }, "Up to date"],
    ] as const;

    for (const [status, label] of cases) {
      renderUpdateStatus(info, status);
      expect(elements["update-status"].textContent).toBe(label);
    }
  });

  it("renders the supplied locale copy without changing updater behavior", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const copy = {
      notAvailableInBuild: "Indisponible dans cette version",
      checking: "Recherche de mises à jour…",
      availableWithVersion: "Mise à jour {{version}} trouvée — téléchargement…",
      available: "Mise à jour trouvée — téléchargement…",
      downloading: "Téléchargement de la mise à jour… {{percent}} %",
      downloaded: "Redémarrer pour mettre à jour",
      error: "Échec de la recherche de mises à jour",
      deferredInstallFailed: "Échec de l’installation de la mise à jour",
      deferredInstallMessage:
        "La mise à jour téléchargée n’a pas pu être installée.",
      retryUpdate: "Réessayer la mise à jour",
      downloadLatestRelease: "Télécharger la dernière version",
      releasePageError: "Impossible d’ouvrir la page de téléchargement.",
      upToDate: "À jour",
      checkForUpdates: "Rechercher des mises à jour",
      progressLabel: "Progression du téléchargement de la mise à jour",
      downloadDetails: "{{transferred}} / {{total}} · {{speed}}",
    };

    renderUpdateStatus(
      { updatesSupported: true },
      { state: "downloading", percent: 42 },
      copy,
    );

    expect(elements["update-status"].textContent).toBe(
      "Téléchargement de la mise à jour… 42 %",
    );
  });

  it("shows and updates the progress bar only while downloading", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const info = { updatesSupported: true };
    const progress = elements["update-progress"];
    const fill = elements["update-progress-fill"];

    renderUpdateStatus(info, {
      state: "downloading",
      percent: 42,
      transferred: 1572864,
      total: 5242880,
      bytesPerSecond: 262144,
    });
    expect(progress.classList.remove).toHaveBeenCalledWith("hidden");
    expect(fill.style.width).toBe("42%");
    expect(progress.setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "42",
    );
    expect(elements["update-progress-details"].textContent).toBe(
      "1.5 MB / 5 MB · 256 KB/s",
    );
    expect(
      elements["update-progress-details"].classList.remove,
    ).toHaveBeenCalledWith("hidden");

    renderUpdateStatus(info, { state: "downloaded" });
    expect(progress.classList.add).toHaveBeenLastCalledWith("hidden");
    expect(fill.style.width).toBe("0%");
    expect(progress.setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "0",
    );
    expect(
      elements["update-progress-details"].classList.add,
    ).toHaveBeenLastCalledWith("hidden");
  });

  it("exposes transfer details as a non-live progress description", () => {
    const html = readFileSync(
      new URL("./settings.html", import.meta.url),
      "utf8",
    );
    const progressMarkup = html.match(
      /<div\b(?=[^>]*\bid="update-progress")[^>]*>/,
    )?.[0];
    const detailsMarkup = html.match(
      /<div\b(?=[^>]*\bid="update-progress-details")[^>]*>/,
    )?.[0];

    expect(progressMarkup).toContain('role="progressbar"');
    expect(progressMarkup).toContain(
      'aria-describedby="update-progress-details"',
    );
    expect(progressMarkup).not.toMatch(/\btabindex=/);
    expect(detailsMarkup).toContain('aria-live="off"');
    expect(detailsMarkup).not.toMatch(/aria-live="(?:polite|assertive)"/);
    expect(detailsMarkup).not.toContain('role="status"');
  });

  it("keeps the latest transfer details available across rapid updates", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const info = { updatesSupported: true };

    renderUpdateStatus(info, {
      state: "downloading",
      percent: 20,
      transferred: 1_048_576,
      total: 5_242_880,
      bytesPerSecond: 262_144,
    });
    renderUpdateStatus(info, {
      state: "downloading",
      percent: 40,
      transferred: 2_097_152,
      total: 5_242_880,
      bytesPerSecond: 524_288,
    });

    expect(elements["update-progress-details"].textContent).toBe(
      "2 MB / 5 MB · 512 KB/s",
    );
    expect(elements["update-progress"].setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "40",
    );
  });

  it("allows a zero-byte start and a temporary zero transfer speed", () => {
    const { renderUpdateStatus, elements } = loadRenderer();

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "downloading",
        percent: 0,
        transferred: 0,
        total: 2048,
        bytesPerSecond: 0,
      },
    );

    expect(elements["update-progress-details"].textContent).toBe(
      "0 B / 2 KB · 0 B/s",
    );
  });

  it("allows a finite fractional transfer rate", () => {
    const { renderUpdateStatus, elements } = loadRenderer();

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "downloading",
        percent: 10,
        transferred: 1024,
        total: 2048,
        bytesPerSecond: 12.5,
      },
    );

    expect(elements["update-progress-details"].textContent).toBe(
      "1 KB / 2 KB · 12.5 B/s",
    );
  });

  it("shows recovery actions for a deferred install failure", () => {
    const { renderUpdateStatus, elements } = loadRenderer();

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "error",
        message: "/internal/path and stack trace must not be rendered",
        deferred: true,
        retryable: true,
      },
    );

    expect(elements["update-status"].textContent).toBe(
      "Update could not be installed",
    );
    expect(elements["update-recovery"].classList.remove).toHaveBeenCalledWith(
      "hidden",
    );
    expect(elements["update-recovery-message"].textContent).toBe(
      "The downloaded update could not be installed. Try again or download the latest release.",
    );
    expect(elements["update-recovery-message"].textContent).not.toContain(
      "/internal/path",
    );
  });

  it("keeps transfer details hidden when Electron omits transfer fields", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const details = elements["update-progress-details"];

    renderUpdateStatus(
      { updatesSupported: true },
      { state: "downloading", percent: 42 },
    );

    expect(elements["update-status"].textContent).toBe(
      "Downloading update… 42%",
    );
    expect(details.textContent).toBe("");
    expect(details.classList.add).toHaveBeenCalledWith("hidden");
  });

  it.each([
    { name: "NaN transferred", metrics: { transferred: Number.NaN } },
    {
      name: "infinite transferred",
      metrics: { transferred: Number.POSITIVE_INFINITY },
    },
    { name: "negative transferred", metrics: { transferred: -1 } },
    { name: "transferred above total", metrics: { transferred: 2049 } },
    {
      name: "oversized transferred",
      metrics: { transferred: Number.MAX_SAFE_INTEGER + 1 },
    },
    { name: "NaN total", metrics: { total: Number.NaN } },
    { name: "infinite total", metrics: { total: Number.POSITIVE_INFINITY } },
    { name: "negative total", metrics: { total: -1 } },
    { name: "zero total", metrics: { total: 0 } },
    {
      name: "oversized total",
      metrics: { total: Number.MAX_SAFE_INTEGER + 1 },
    },
    { name: "NaN download speed", metrics: { bytesPerSecond: Number.NaN } },
    {
      name: "infinite download speed",
      metrics: { bytesPerSecond: Number.POSITIVE_INFINITY },
    },
    { name: "negative download speed", metrics: { bytesPerSecond: -1 } },
    {
      name: "oversized download speed",
      metrics: { bytesPerSecond: Number.MAX_SAFE_INTEGER + 1 },
    },
  ])("keeps percentage-only progress for $name", ({ metrics }) => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const progress = elements["update-progress"];
    const fill = elements["update-progress-fill"];
    const details = elements["update-progress-details"];

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "downloading",
        percent: 20,
        transferred: 1024,
        total: 2048,
        bytesPerSecond: 512,
      },
    );
    expect(details.textContent).not.toBe("");

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "downloading",
        percent: 37,
        transferred: 1024,
        total: 2048,
        bytesPerSecond: 512,
        ...metrics,
      },
    );

    expect(progress.classList.remove).toHaveBeenCalledWith("hidden");
    expect(elements["update-status"].textContent).toBe(
      "Downloading update… 37%",
    );
    expect(fill.style.width).toBe("37%");
    expect(progress.setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "37",
    );
    expect(details.classList.add).toHaveBeenCalledWith("hidden");
    expect(details.textContent).toBe("");
    expect(details.textContent).not.toMatch(/NaN|Infinity|-\d|\/s/);
  });

  it("disables updates and hides progress when the build is unpackaged", () => {
    const { renderUpdateStatus, elements } = loadRenderer();

    renderUpdateStatus(
      { updatesSupported: true },
      {
        state: "downloading",
        percent: 42,
        transferred: 1024,
        total: 2048,
        bytesPerSecond: 1024,
      },
    );
    renderUpdateStatus(
      { updatesSupported: false },
      { state: "downloading", percent: 42 },
    );

    expect(elements["update-status"].textContent).toBe(
      "Not available in this build",
    );
    expect(elements["check-updates"].disabled).toBe(true);
    expect(elements["update-progress"].classList.add).toHaveBeenCalledWith(
      "hidden",
    );
    expect(
      elements["update-progress-details"].classList.add,
    ).toHaveBeenLastCalledWith("hidden");
  });
});
