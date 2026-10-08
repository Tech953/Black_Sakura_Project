import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(
  new URL("./sanitize-smoke-log.mjs", import.meta.url),
);
const tempDirectories = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged smoke log sanitization", () => {
  it("redacts credentials and paths, then bounds the saved log", () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "engram-smoke-sanitize-"),
    );
    tempDirectories.push(directory);
    const filePath = path.join(directory, "smoke.log");
    const workspace = "/runner/work/engram/private";
    const secret = "fixture-only-token-value";
    writeFileSync(
      filePath,
      [
        "x".repeat(300 * 1024),
        `workspace=${workspace}/artifacts/desktop`,
        `home=${path.join(os.homedir(), "runner-home")}`,
        `tmp=${path.join(os.tmpdir(), "runner-temp")}`,
        `token=${secret} Bearer fixture-bearer-value`,
        "latest-marker",
      ].join("\n"),
    );

    execFileSync(process.execPath, [scriptPath, filePath], {
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        DIAGNOSTICS_TOKEN: secret,
      },
    });

    const sanitized = readFileSync(filePath, "utf8");
    expect(Buffer.byteLength(sanitized)).toBeLessThanOrEqual(256 * 1024);
    expect(sanitized).toContain("[diagnostic output truncated");
    expect(sanitized).toContain("<workspace>/artifacts/desktop");
    expect(sanitized).toContain("<home>/runner-home");
    expect(sanitized).toContain("<tmp>/runner-temp");
    expect(sanitized).toContain("token=[redacted]");
    expect(sanitized).toContain("Bearer [redacted]");
    expect(sanitized).toContain("latest-marker");
    expect(sanitized).not.toContain(workspace);
    expect(sanitized).not.toContain(secret);
  });
});
