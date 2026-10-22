import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
    previousHandler: vi.fn(),
    installedHandler: null as
      | ((error: unknown, isFatal?: boolean) => void)
      | null,
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: mocks.getItem,
    setItem: mocks.setItem,
    removeItem: mocks.removeItem,
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

const CRASH_REPORT_KEY = "engram.lastFatalCrash.v1";
const LAUNCH_BREADCRUMB_KEY = "engram.launchBreadcrumb.v1";

function installMockErrorUtils() {
  mocks.installedHandler = null;
  Object.defineProperty(globalThis, "ErrorUtils", {
    configurable: true,
    value: {
      getGlobalHandler: () => mocks.previousHandler,
      setGlobalHandler: (
        handler: (error: unknown, isFatal?: boolean) => void,
      ) => {
        mocks.installedHandler = handler;
      },
    },
  });
}

beforeEach(() => {
  vi.resetModules();
  mocks.storage.clear();
  mocks.getItem.mockClear();
  mocks.setItem.mockClear();
  mocks.removeItem.mockClear();
  mocks.previousHandler.mockReset();
  installMockErrorUtils();
});

describe("mobile crash log", () => {
  it("persists a bounded fatal report with the latest launch stage", async () => {
    const crashLog = await import("./crash-log");
    await crashLog.beginLaunchCrashMonitoring();
    await crashLog.updateLaunchBreadcrumb("loading-personas");

    const error = new Error("fatal launch failure");
    error.stack = `Error: fatal launch failure\n${"x".repeat(70_000)}`;
    await crashLog.persistFatalCrash(error, {
      source: "react-boundary",
      componentStack: "\n  at RootLayout\n  at App",
    });

    const report = JSON.parse(mocks.storage.get(CRASH_REPORT_KEY) ?? "{}");
    expect(report).toMatchObject({
      version: 1,
      source: "react-boundary",
      platform: "android",
      message: "fatal launch failure",
      launchStage: "loading-personas",
      componentStack: "\n  at RootLayout\n  at App",
    });
    expect(report.stack).toContain("[truncated]");
    expect(report.stack.length).toBeLessThan(64_100);
  });

  it("surfaces an unfinished prior launch when no JS stack was captured", async () => {
    mocks.storage.set(
      LAUNCH_BREADCRUMB_KEY,
      JSON.stringify({
        version: 1,
        startedAt: "2026-09-05T00:00:00.000Z",
        stage: "root-layout-mounted",
      }),
    );

    const crashLog = await import("./crash-log");
    const report = await crashLog.beginLaunchCrashMonitoring();

    expect(report).toMatchObject({
      occurredAt: "2026-09-05T00:00:00.000Z",
      source: "startup-breadcrumb",
      platform: "android",
      launchStage: "root-layout-mounted",
    });
    expect(report?.message).toContain("previous launch ended");
    expect(mocks.storage.get(LAUNCH_BREADCRUMB_KEY)).toContain(
      "root-layout-mounted",
    );
  });

  it("loads the prior fatal report and clears recovery state independently", async () => {
    mocks.storage.set(
      CRASH_REPORT_KEY,
      JSON.stringify({
        version: 1,
        occurredAt: "2026-09-05T00:01:00.000Z",
        source: "global-js",
        platform: "android",
        message: "native module exploded",
        stack: "Error: native module exploded",
        componentStack: null,
        launchStage: null,
      }),
    );
    mocks.storage.set(
      LAUNCH_BREADCRUMB_KEY,
      JSON.stringify({
        version: 1,
        startedAt: "2026-09-05T00:00:59.000Z",
        stage: "server-config-ready",
      }),
    );

    const crashLog = await import("./crash-log");
    const report = await crashLog.beginLaunchCrashMonitoring();
    expect(report?.launchStage).toBe("server-config-ready");
    expect(crashLog.formatCrashReport(report!)).toContain(
      "native module exploded",
    );

    await crashLog.clearPreviousCrash();
    expect(mocks.storage.has(CRASH_REPORT_KEY)).toBe(false);
    expect(mocks.storage.has(LAUNCH_BREADCRUMB_KEY)).toBe(true);

    await crashLog.markLaunchReady();
    expect(mocks.storage.has(LAUNCH_BREADCRUMB_KEY)).toBe(false);
  });

  it("flushes fatal global errors before forwarding to the platform handler", async () => {
    await import("./crash-log");
    expect(mocks.installedHandler).toBeTypeOf("function");

    mocks.installedHandler?.(new Error("uncaught global"), true);
    await vi.waitFor(() => {
      expect(mocks.storage.has(CRASH_REPORT_KEY)).toBe(true);
      expect(mocks.previousHandler).toHaveBeenCalledOnce();
    });

    const report = JSON.parse(mocks.storage.get(CRASH_REPORT_KEY) ?? "{}");
    expect(report).toMatchObject({
      source: "global-js",
      message: "uncaught global",
    });
  });

  it("forwards nonfatal global errors without replacing the fatal report", async () => {
    mocks.storage.set(CRASH_REPORT_KEY, "existing-fatal-report");
    await import("./crash-log");

    mocks.installedHandler?.(new Error("recoverable"), false);

    expect(mocks.previousHandler).toHaveBeenCalledOnce();
    expect(mocks.storage.get(CRASH_REPORT_KEY)).toBe(
      "existing-fatal-report",
    );
  });
});