import { describe, expect, it } from "vitest";
import {
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

  it.each([
    { ...valid, path: "../outside.gguf" },
    { ...valid, path: "other.gguf" },
    { ...valid, sha256: "not-a-fingerprint" },
    { ...valid, originalFilename: "../outside.gguf" },
    { ...valid, ggufVersion: 4 },
    { ...valid, importedAt: "not-a-date" },
  ])("drops forged or malformed custom metadata", (candidate) => {
    expect(normalizeCustomGgufMetadata(candidate)).toBeUndefined();
  });
});