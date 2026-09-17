import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  localModelFailureCopy,
  localModelFailureFromError,
  normalizeLocalModelFailure,
  normalizeCustomGgufMetadata,
  normalizeDesktopMode,
} from "./desktop-settings";

const sha256 = "a".repeat(64);
const valid = {
  path: `${sha256}.gguf`,
  originalFilename: "my-model.gguf",
  byteSize: 4_000_000_000,
  sha256,
  ggufVersion: 3,
  importedAt: "2026-09-04T12:00:00.000Z",
};

describe("persisted desktop settings migration", () => {
  it("keeps all supported legacy/current modes and safely defaults unknown values", () => {
    expect(normalizeDesktopMode("bundled")).toBe("bundled");
    expect(normalizeDesktopMode("offline")).toBe("offline");
    expect(normalizeDesktopMode("online")).toBe("online");
    expect(normalizeDesktopMode("custom")).toBe("custom");
    expect(normalizeDesktopMode("forged")).toBe("bundled");
  });

  it("accepts persisted app-owned metadata without requiring a new field in old settings", () => {
    expect(normalizeCustomGgufMetadata(undefined)).toBeUndefined();
    expect(normalizeCustomGgufMetadata(valid)).toEqual(valid);
  });

  it("accepts the optional model-library display and usage metadata", () => {
    expect(
      normalizeCustomGgufMetadata({
        ...valid,
        displayName: "Qwen local",
        lastUsedAt: "2026-09-12T12:00:00.000Z",
      }),
    ).toMatchObject({
      displayName: "Qwen local",
      lastUsedAt: "2026-09-12T12:00:00.000Z",
    });
  });

  it.each([
    { ...valid, path: "../outside.gguf" },
    { ...valid, path: "other.gguf" },
    { ...valid, sha256: "not-a-fingerprint" },
    { ...valid, originalFilename: "../outside.gguf" },
    { ...valid, ggufVersion: 4 },
    { ...valid, importedAt: "not-a-date" },
    { ...valid, displayName: " " },
    { ...valid, displayName: "x".repeat(129) },
    { ...valid, lastUsedAt: "not-a-date" },
  ])("drops forged or malformed custom metadata", (candidate) => {
    expect(normalizeCustomGgufMetadata(candidate)).toBeUndefined();
  });

  it("turns a missing Linux runtime library into actionable Settings copy", () => {
    const failure = localModelFailureFromError(
      new Error(
        "Local model server exited before becoming ready (code=127, signal=null).",
      ),
      "linux",
      "error while loading shared libraries: libgomp.so.1: cannot open shared object file",
    );

    expect(failure).toMatchObject({
      code: "missing-linux-dependencies",
      platform: "linux",
      missingLibraries: ["libgomp.so.1"],
      automaticFixAvailable: false,
    });
    expect(localModelFailureCopy(failure)).toMatchObject({
      title: "Built-in model needs Linux libraries",
      recovery: expect.stringContaining("Select Local server or Online"),
    });
    expect(
      normalizeLocalModelFailure({
        ...failure,
        missingLibraries: ["libgomp.so.1", 42],
      }),
    ).toMatchObject(failure);
  });

  it("keeps the Settings recovery panel and provider-switch instruction visible", () => {
    const settingsHtml = readFileSync(
      path.join(__dirname, "settings.html"),
      "utf8",
    );
    expect(settingsHtml).toContain('id="local-model-failure-box"');
    expect(settingsHtml).toContain('id="retry-bundled"');
    expect(settingsHtml).toContain("retryBundledModel()");
    expect(settingsHtml).toContain("Select Local server or Online");
    expect(settingsHtml).toContain("Save & Restart");
    expect(settingsHtml).toContain(
      "renderLocalModelFailure(res.localModelFailure, mode === \"bundled\")",
    );
  });
});
