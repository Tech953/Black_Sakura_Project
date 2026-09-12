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
  status: { state: string; percent?: number; version?: string },
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
    status: { state: string; percent?: number; version?: string },
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

  it("shows and updates the progress bar only while downloading", () => {
    const { renderUpdateStatus, elements } = loadRenderer();
    const info = { updatesSupported: true };
    const progress = elements["update-progress"];
    const fill = elements["update-progress-fill"];

    renderUpdateStatus(info, { state: "downloading", percent: 42 });
    expect(progress.classList.remove).toHaveBeenCalledWith("hidden");
    expect(fill.style.width).toBe("42%");
    expect(progress.setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "42",
    );

    renderUpdateStatus(info, { state: "downloaded" });
    expect(progress.classList.add).toHaveBeenLastCalledWith("hidden");
    expect(fill.style.width).toBe("0%");
    expect(progress.setAttribute).toHaveBeenLastCalledWith(
      "aria-valuenow",
      "0",
    );
  });

  it("disables updates and hides progress when the build is unpackaged", () => {
    const { renderUpdateStatus, elements } = loadRenderer();

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
  });
});
