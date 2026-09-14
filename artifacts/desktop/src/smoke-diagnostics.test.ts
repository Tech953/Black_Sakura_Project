import { readFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendBoundedDiagnostic,
  MAX_SMOKE_DIAGNOSTIC_BYTES,
  sanitizeDiagnosticText,
} from "./smoke-diagnostics";

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
});
