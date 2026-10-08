import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ChildProcess } from "node:child_process";

export const MAX_SMOKE_DIAGNOSTIC_BYTES = 256 * 1024;

export interface ChildOutputCaptureOptions {
  stdoutFile: string;
  stderrFile: string;
  append: (filename: string, value: string) => void;
  sanitize: (value: string) => string;
  onStdout?: (value: string) => void;
  onStderr?: (value: string) => void;
}

export interface ChildStartupHandlers {
  onSpawnError: (error: Error) => Error;
  onEarlyExit: (code: number | null, signal: NodeJS.Signals | null) => Error;
  onUnexpectedExit?: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
}

export interface HealthProbeResult {
  healthy: boolean;
  failure?: string;
}

export interface WaitForHealthProbeOptions {
  probe: () => Promise<HealthProbeResult>;
  timeoutMs: number;
  retryIntervalMs: number;
  failureMessage: string;
  now?: () => number;
  delay?: (milliseconds: number) => Promise<void>;
  onTimeout?: (error: Error) => void;
}

export function captureChildOutput(
  child: Pick<ChildProcess, "stdout" | "stderr">,
  options: ChildOutputCaptureOptions,
): void {
  child.stdout?.on("data", (chunk: Buffer) => {
    const output = options.sanitize(chunk.toString());
    options.append(options.stdoutFile, output);
    options.onStdout?.(output);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const output = options.sanitize(chunk.toString());
    options.append(options.stderrFile, output);
    options.onStderr?.(output);
  });
}

export function raceChildStartup<T>(
  child: Pick<ChildProcess, "on">,
  readiness: Promise<T>,
  handlers: ChildStartupHandlers,
): Promise<T> {
  let state: "waiting" | "ready" | "failed" = "waiting";
  return new Promise<T>((resolve, reject) => {
    child.on("error", (error) => {
      if (state !== "waiting") return;
      state = "failed";
      reject(handlers.onSpawnError(error));
    });
    child.on("exit", (code, signal) => {
      if (state === "waiting") {
        state = "failed";
        reject(handlers.onEarlyExit(code, signal));
      } else if (state === "ready") {
        handlers.onUnexpectedExit?.(code, signal);
      }
    });
    void readiness.then(
      (value) => {
        if (state !== "waiting") return;
        state = "ready";
        resolve(value);
      },
      (error: unknown) => {
        if (state !== "waiting") return;
        state = "failed";
        reject(error);
      },
    );
  });
}

export async function waitForHealthProbe({
  probe,
  timeoutMs,
  retryIntervalMs,
  failureMessage,
  now = () => Date.now(),
  delay = (milliseconds) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  onTimeout,
}: WaitForHealthProbeOptions): Promise<void> {
  const startedAt = now();
  let lastFailure = "no health response received";
  while (true) {
    try {
      const result = await probe();
      if (result.healthy) return;
      lastFailure =
        result.failure || "health endpoint returned an unhealthy response";
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (now() - startedAt >= timeoutMs) {
      const timeoutError = new Error(
        `${failureMessage}${lastFailure ? ` Last check: ${lastFailure}.` : ""}`,
      );
      onTimeout?.(timeoutError);
      throw timeoutError;
    }
    await delay(retryIntervalMs);
  }
}

export function recordStartupFailure(
  appendDiagnostic: (filename: string, value: string) => void,
  context: string,
  error: unknown,
): string {
  const detail = error instanceof Error ? error.message : String(error);
  const line = `${context}: ${detail}\n`;
  appendDiagnostic("main.log", line);
  return line.trimEnd();
}

export function sanitizeDiagnosticText(
  value: string,
  replacements: Array<[string, string]> = [],
  secretValues: string[] = [],
): string {
  let safe = value;
  for (const [source, replacement] of replacements) {
    if (source) safe = safe.split(source).join(replacement);
  }
  for (const secret of secretValues) {
    if (secret) safe = safe.split(secret).join("[redacted]");
  }
  return safe
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(
      /\b(api[_-]?key|token|secret|password|authorization)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[redacted]",
    );
}

export function appendBoundedDiagnostic(
  filePath: string,
  value: string,
  maxBytes = MAX_SMOKE_DIAGNOSTIC_BYTES,
): void {
  const incoming = Buffer.from(value, "utf8");
  if (incoming.length === 0) return;
  mkdirSync(path.dirname(filePath), { recursive: true });

  if (!existsSync(filePath)) {
    writeFileSync(filePath, incoming, { mode: 0o600 });
    return;
  }

  const currentBytes = statSync(filePath).size;
  if (currentBytes + incoming.length <= maxBytes) {
    appendFileSync(filePath, incoming);
    return;
  }

  const marker = Buffer.from(
    "\n[diagnostic output truncated; showing the most recent bytes]\n",
    "utf8",
  );
  const existing = readFileSync(filePath);
  const payloadCapacity = Math.max(0, maxBytes - marker.length);
  const output =
    incoming.length >= payloadCapacity
      ? Buffer.concat([marker, incoming.subarray(-payloadCapacity)]).subarray(
          -maxBytes,
        )
      : Buffer.concat([
          marker,
          existing.subarray(
            Math.max(0, existing.length - payloadCapacity + incoming.length),
          ),
          incoming,
        ]).subarray(-maxBytes);
  writeFileSync(filePath, output, { mode: 0o600 });
}
