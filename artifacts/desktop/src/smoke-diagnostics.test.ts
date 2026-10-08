import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendBoundedDiagnostic,
  captureChildOutput,
  MAX_SMOKE_DIAGNOSTIC_BYTES,
  raceChildStartup,
  recordStartupFailure,
  sanitizeDiagnosticText,
  waitForHealthProbe,
} from "./smoke-diagnostics";

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
}

describe("smoke diagnostics", () => {
  it("redacts credentials and machine-specific paths", () => {
    const result = sanitizeDiagnosticText(
      "workspace=/runner/work/app server token=abc123 Bearer xyz /tmp/user",
      [
        ["/runner/work/app", "<workspace>"],
        ["/tmp/user", "<user-data>"],
      ],
      ["abc123"],
    );

    expect(result).toBe(
      "workspace=<workspace> server token=[redacted] Bearer [redacted] <user-data>",
    );
  });

  it("keeps the diagnostic file bounded while retaining recent output", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "engram-smoke-"));
    const filePath = path.join(directory, "server.stderr.log");
    const maxBytes = 128;

    appendBoundedDiagnostic(filePath, "early failure\n", maxBytes);
    appendBoundedDiagnostic(filePath, "x".repeat(256), maxBytes);

    const result = readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(result)).toBeLessThanOrEqual(maxBytes);
    expect(result).toContain("diagnostic output truncated");
    expect(result.endsWith("x".repeat(256).slice(-64))).toBe(true);
    expect(MAX_SMOKE_DIAGNOSTIC_BYTES).toBe(256 * 1024);
  });

  it.each([
    ["server", "server.stdout.log", "server.stderr.log"],
    ["llama", "llama.stdout.log", "llama.stderr.log"],
  ])(
    "captures %s child stderr before reporting an early exit",
    async (_name, stdoutFile, stderrFile) => {
      const child = new FakeChild();
      const files = new Map<string, string>();
      let startupStderr = "";
      const sanitize = (value: string): string =>
        sanitizeDiagnosticText(value, [], ["credential-secret"]);

      captureChildOutput(
        child as unknown as Pick<ChildProcess, "stdout" | "stderr">,
        {
          stdoutFile,
          stderrFile,
          append: (filename, value) =>
            files.set(filename, `${files.get(filename) ?? ""}${value}`),
          sanitize,
          onStderr: (value) => {
            startupStderr = `${startupStderr}${value}`.slice(-12_000);
          },
        },
      );
      const readiness = new Promise<void>(() => {});
      const startup = raceChildStartup(
        child as unknown as Pick<ChildProcess, "on">,
        readiness,
        {
          onSpawnError: (error) => error,
          onEarlyExit: (code, signal) =>
            new Error(
              `early exit code=${code}, signal=${signal}; ${startupStderr.trim()}`,
            ),
        },
      );

      child.stderr.emit(
        "data",
        Buffer.from("decoder failed token=credential-secret\n"),
      );
      child.emit("exit", 2, null);

      await expect(startup).rejects.toThrow(
        "early exit code=2, signal=null; decoder failed token=[redacted]",
      );
      expect(files.get(stderrFile)).toContain("token=[redacted]");
      expect(files.has(stdoutFile)).toBe(false);
    },
  );

  it("records an early main-process startup failure without a child process", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "engram-smoke-"));
    const filePath = path.join(directory, "main.log");
    const recorded = recordStartupFailure(
      (filename, value) => {
        expect(filename).toBe("main.log");
        appendBoundedDiagnostic(
          filePath,
          sanitizeDiagnosticText(value, [
            ["/private/workspace", "<workspace>"],
          ]),
          512,
        );
      },
      "desktop main-process startup failed",
      new Error("cannot load /private/workspace/server.cjs"),
    );

    expect(recorded).toContain("desktop main-process startup failed");
    expect(recorded).toContain("/private/workspace/server.cjs");
    const diagnostic = readFileSync(filePath, "utf8");
    expect(diagnostic).toContain("desktop main-process startup failed");
    expect(diagnostic).toContain("<workspace>/server.cjs");
    expect(diagnostic).not.toContain("/private/workspace");
  });

  it("includes the last health failure in bounded timeout diagnostics", async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "engram-smoke-"));
    const filePath = path.join(directory, "main.log");
    const maxBytes = 256;
    appendBoundedDiagnostic(filePath, "x".repeat(400), maxBytes);
    let now = 0;

    const wait = waitForHealthProbe({
      probe: async () => ({
        healthy: false,
        failure: "HTTP 503: database still migrating",
      }),
      timeoutMs: 5,
      retryIntervalMs: 3,
      failureMessage: "Embedded server did not become healthy in time.",
      now: () => now,
      delay: async (milliseconds) => {
        now += milliseconds;
      },
      onTimeout: (error) =>
        appendBoundedDiagnostic(
          filePath,
          sanitizeDiagnosticText(`health timeout: ${error.message}\n`),
          maxBytes,
        ),
    });

    await expect(wait).rejects.toThrow(
      "Last check: HTTP 503: database still migrating.",
    );
    const diagnostic = readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(maxBytes);
    expect(diagnostic).toContain("HTTP 503: database still migrating");
  });
});
