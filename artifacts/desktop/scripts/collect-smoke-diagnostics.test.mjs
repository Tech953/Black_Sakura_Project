import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectPackagedResourceListing,
  MAX_RESOURCE_LISTING_BYTES,
} from "./collect-smoke-diagnostics.mjs";

const tempDirectories = [];
function createTempDirectory() {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "engram-resource-list-"),
  );
  tempDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("packaged smoke resource diagnostics", () => {
  it.each(["linux", "mac", "win"])(
    "writes a useful listing when the %s packaging output is absent",
    (platform) => {
      const root = createTempDirectory();
      const outputFile = path.join(root, "diagnostics", "resource-listing.txt");

      expect(() =>
        collectPackagedResourceListing({
          platform,
          releaseDir: path.join(root, "missing-release"),
          outputFile,
          cwd: root,
        }),
      ).not.toThrow();
      expect(existsSync(outputFile)).toBe(true);

      const listing = readFileSync(outputFile, "utf8");
      expect(listing).toContain(`platform=${platform}`);
      expect(listing).toContain(
        "[resource-root] no packaged resources directory found",
      );
      expect(listing).not.toContain(root);
    },
  );

  it("lists resource files with workspace-relative paths only", () => {
    const root = createTempDirectory();
    const releaseDir = path.join(root, "artifacts", "desktop", "release");
    const resourceFile = path.join(
      releaseDir,
      "linux-unpacked",
      "resources",
      "app.asar",
    );
    mkdirSync(path.dirname(resourceFile), { recursive: true });
    writeFileSync(resourceFile, "packaged resources");
    const outputFile = path.join(root, "diagnostics", "resource-listing.txt");

    collectPackagedResourceListing({
      platform: "linux",
      releaseDir,
      outputFile,
      cwd: root,
    });

    const listing = readFileSync(outputFile, "utf8");
    expect(listing).toContain(
      "artifacts/desktop/release/linux-unpacked/resources/app.asar",
    );
    expect(listing).toContain("18 bytes");
    expect(listing).not.toContain(root);
  });

  it("bounds oversized resource listings", () => {
    const root = createTempDirectory();
    const releaseDir = path.join(root, "artifacts", "desktop", "release");
    const resources = path.join(releaseDir, "linux-unpacked", "resources");
    mkdirSync(resources, { recursive: true });
    for (let index = 0; index < 20; index += 1) {
      writeFileSync(
        path.join(resources, `resource-${index}.bin`),
        "x".repeat(20),
      );
    }
    const outputFile = path.join(root, "diagnostics", "resource-listing.txt");

    const result = collectPackagedResourceListing({
      platform: "linux",
      releaseDir,
      outputFile,
      cwd: root,
      maxBytes: 160,
    });

    const listing = readFileSync(outputFile, "utf8");
    expect(result.byteLength).toBeLessThanOrEqual(160);
    expect(Buffer.byteLength(listing)).toBeLessThanOrEqual(160);
    expect(listing).toContain("resource listing truncated");
    expect(MAX_RESOURCE_LISTING_BYTES).toBe(256 * 1024);
  });
});
