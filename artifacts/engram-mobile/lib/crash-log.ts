import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const CRASH_REPORT_KEY = "engram.lastFatalCrash.v1";
const LAUNCH_BREADCRUMB_KEY = "engram.launchBreadcrumb.v1";
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 64_000;
const MAX_COMPONENT_STACK_LENGTH = 32_000;

export type CrashSource =
  | "global-js"
  | "react-boundary"
  | "startup-breadcrumb";

export type CrashReport = {
  version: 1;
  occurredAt: string;
  source: CrashSource;
  platform: string;
  message: string;
  stack: string | null;
  componentStack: string | null;
  launchStage: string | null;
};

type LaunchBreadcrumb = {
  version: 1;
  startedAt: string;
  stage: string;
};

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler?: () => GlobalErrorHandler;
  setGlobalHandler?: (handler: GlobalErrorHandler) => void;
};

let installed = false;
let writingCrash = false;
let launchBreadcrumb: LaunchBreadcrumb | null = null;

function trim(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}\n[truncated]` : value;
}

function normalizeError(error: unknown): {
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      message: trim(error.message, MAX_MESSAGE_LENGTH) ?? "Unknown fatal error",
      stack: trim(error.stack, MAX_STACK_LENGTH),
    };
  }
  let serialized: string;
  try {
    serialized =
      typeof error === "string" ? error : JSON.stringify(error) || String(error);
  } catch {
    serialized = String(error);
  }
  const message =
    trim(serialized, MAX_MESSAGE_LENGTH) ?? "Unknown fatal error";
  return { message, stack: null };
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function isCrashReport(value: CrashReport | null): value is CrashReport {
  return (
    value?.version === 1 &&
    typeof value.occurredAt === "string" &&
    typeof value.message === "string"
  );
}

function isLaunchBreadcrumb(
  value: LaunchBreadcrumb | null,
): value is LaunchBreadcrumb {
  return (
    value?.version === 1 &&
    typeof value.startedAt === "string" &&
    typeof value.stage === "string"
  );
}

export async function persistFatalCrash(
  error: unknown,
  options: {
    source: Exclude<CrashSource, "startup-breadcrumb">;
    componentStack?: string | null;
  },
): Promise<void> {
  if (writingCrash) return;
  writingCrash = true;
  try {
    const normalized = normalizeError(error);
    const report: CrashReport = {
      version: 1,
      occurredAt: new Date().toISOString(),
      source: options.source,
      platform: Platform.OS,
      message: normalized.message,
      stack: normalized.stack,
      componentStack: trim(
        options.componentStack,
        MAX_COMPONENT_STACK_LENGTH,
      ),
      launchStage: launchBreadcrumb?.stage ?? null,
    };
    await AsyncStorage.setItem(CRASH_REPORT_KEY, JSON.stringify(report));
  } finally {
    writingCrash = false;
  }
}

/**
 * Load the prior fatal report (or an unfinished-launch breadcrumb), then mark
 * this launch as in progress. The marker is removed only after the app renders.
 */
export async function beginLaunchCrashMonitoring(): Promise<CrashReport | null> {
  const [storedReport, storedBreadcrumb] = await Promise.all([
    AsyncStorage.getItem(CRASH_REPORT_KEY),
    AsyncStorage.getItem(LAUNCH_BREADCRUMB_KEY),
  ]);
  const previousReport = parseJson<CrashReport>(storedReport);
  const previousBreadcrumb = parseJson<LaunchBreadcrumb>(storedBreadcrumb);

  launchBreadcrumb = {
    version: 1,
    startedAt: new Date().toISOString(),
    stage: "root-layout-mounted",
  };
  await AsyncStorage.setItem(
    LAUNCH_BREADCRUMB_KEY,
    JSON.stringify(launchBreadcrumb),
  );

  if (isCrashReport(previousReport)) {
    return {
      ...previousReport,
      launchStage:
        previousReport.launchStage ??
        (isLaunchBreadcrumb(previousBreadcrumb)
          ? previousBreadcrumb.stage
          : null),
    };
  }
  if (isLaunchBreadcrumb(previousBreadcrumb)) {
    return {
      version: 1,
      occurredAt: previousBreadcrumb.startedAt,
      source: "startup-breadcrumb",
      platform: Platform.OS,
      message:
        "The previous launch ended before the app reached its ready state.",
      stack: null,
      componentStack: null,
      launchStage: previousBreadcrumb.stage,
    };
  }
  return null;
}

export async function updateLaunchBreadcrumb(stage: string): Promise<void> {
  if (!launchBreadcrumb) return;
  launchBreadcrumb = { ...launchBreadcrumb, stage };
  await AsyncStorage.setItem(
    LAUNCH_BREADCRUMB_KEY,
    JSON.stringify(launchBreadcrumb),
  );
}

export async function markLaunchReady(): Promise<void> {
  launchBreadcrumb = null;
  await AsyncStorage.removeItem(LAUNCH_BREADCRUMB_KEY);
}

export async function clearPreviousCrash(): Promise<void> {
  await AsyncStorage.removeItem(CRASH_REPORT_KEY);
}

export function formatCrashReport(report: CrashReport): string {
  return [
    `Occurred: ${report.occurredAt}`,
    `Platform: ${report.platform}`,
    `Source: ${report.source}`,
    `Startup stage: ${report.launchStage ?? "unknown"}`,
    "",
    `Message:\n${report.message}`,
    report.stack ? `\nStack:\n${report.stack}` : "",
    report.componentStack
      ? `\nReact component stack:\n${report.componentStack}`
      : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function installGlobalErrorHandler(): void {
  if (installed) return;
  const errorUtils = (
    globalThis as typeof globalThis & { ErrorUtils?: ErrorUtilsLike }
  ).ErrorUtils;
  if (!errorUtils?.setGlobalHandler) return;

  const previousHandler = errorUtils.getGlobalHandler?.();
  errorUtils.setGlobalHandler((error, isFatal) => {
    if (isFatal === false) {
      previousHandler?.(error, isFatal);
      return;
    }
    let forwarded = false;
    const forward = () => {
      if (forwarded) return;
      forwarded = true;
      previousHandler?.(error, isFatal);
    };
    const timeout = setTimeout(forward, 250);
    void persistFatalCrash(error, { source: "global-js" }).finally(() => {
      clearTimeout(timeout);
      forward();
    });
  });
  installed = true;
}

// Install during module evaluation, before RootLayout begins asynchronous work.
installGlobalErrorHandler();