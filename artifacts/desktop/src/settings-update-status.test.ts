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

describe("Settings update status renderer", () => {
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
