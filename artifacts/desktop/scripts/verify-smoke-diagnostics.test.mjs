import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_VERIFIED_DIAGNOSTIC_BYTES,
  verifyPackagedSmokeDiagnostics,
} from "./verify-smoke-diagnostics.mjs";

const tempDirectories = [];
function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "engram-smoke-verify-"));
  tempDirectories.push(root);
  const diagnosticsDir = path.join(root, "failure-probe");
  mkdirSync(diagnosticsDir, { recursive: true });
  const resourceListingPath = path.join(root, "resource-listing.txt");
  const files = {
    "smoke.log": [
      "[smoke] /api/healthz -> 200 OK",
      "[smoke] FAIL: Error: intentional diagnostics probe: health check failure",
      "expected status=503, received 200; token=[redacted]; path=<tmp>/engram-diagnostics-probe",
      "",
    ].join("\n"),
    "main.log":
      "desktop main process initialized\ndiagnostics probe marker token=[redacted] path=<tmp>/engram-diagnostics-probe\n",
    "server.stdout.log":
      "embedded server stdout capture active\n[server] started\n",
    "server.stderr.log": "embedded server stderr capture active\n",
  };
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(diagnosticsDir, name), content);
  }
  writeFileSync(
    resourceListingPath,
    "platform=linux\nartifacts/desktop/release/linux-unpacked/resources/app.asar\t17 bytes\n",
  );
  return { root, diagnosticsDir, resourceListingPath };
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged smoke diagnostic verification", () => {
  it("accepts bounded logs with expected failure and redaction evidence", () => {
    const fixture = createFixture();
    const result = verifyPackagedSmokeDiagnostics({
      diagnosticsDir: fixture.diagnosticsDir,
      resourceListingPath: fixture.resourceListingPath,
      platform: "linux",
      cwd: "/runner/work/engram/repo",
      workspace: "/runner/work/engram/repo",
      home: "/home/runner",
      tempDir: "/tmp",
      secretValues: ["diagnostic-probe-secret"],
    });

    expect(result.files).toContain("main.log");
    expect(result.files).toContain("server.stdout.log");
    expect(result.files).toContain("server.stderr.log");
    expect(result.files).toContain("resource-listing.txt");
    expect(result.totalBytes).toBeGreaterThan(0);
    expect(MAX_VERIFIED_DIAGNOSTIC_BYTES).toBe(256 * 1024);
  });

  it("rejects unredacted machine paths", () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.diagnosticsDir, "smoke.log"),
      "[smoke] /api/healthz -> 200 OK\nintentional diagnostics probe: health check failure token=[redacted] path=<tmp>\n/runner/work/engram/repo\n",
    );

    expect(() =>
      verifyPackagedSmokeDiagnostics({
        diagnosticsDir: fixture.diagnosticsDir,
        resourceListingPath: fixture.resourceListingPath,
        platform: "linux",
        cwd: "/runner/work/engram/repo",
        workspace: "/runner/work/engram/repo",
        home: "/home/runner",
        tempDir: "/tmp",
        secretValues: [],
      }),
    ).toThrow("unredacted machine path");
  });

  it("rejects credential-shaped values in child-process logs", () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.diagnosticsDir, "server.stderr.log"),
      "embedded server stderr capture active\nBearer leaked-value\n",
    );

    expect(() =>
      verifyPackagedSmokeDiagnostics({
        diagnosticsDir: fixture.diagnosticsDir,
        resourceListingPath: fixture.resourceListingPath,
        platform: "linux",
        secretValues: [],
      }),
    ).toThrow("credential-shaped value");
  });

  it("rejects logs that exceed the diagnostics size limit", () => {
    const fixture = createFixture();
    writeFileSync(
      path.join(fixture.diagnosticsDir, "main.log"),
      "x".repeat(MAX_VERIFIED_DIAGNOSTIC_BYTES + 1),
    );

    expect(() =>
      verifyPackagedSmokeDiagnostics({
        diagnosticsDir: fixture.diagnosticsDir,
        resourceListingPath: fixture.resourceListingPath,
        platform: "linux",
        secretValues: [],
      }),
    ).toThrow("exceeds");
  });
});
