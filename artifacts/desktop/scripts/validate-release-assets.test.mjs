import { describe, expect, it } from "vitest";
import {
  RELEASE_TARGETS,
  validateReleaseAssets,
} from "./validate-release-assets.mjs";

const completeAssetNames = [
  "ENGRAM-1.2.3-x64.AppImage",
  "engram_1.2.3-x64.deb",
  "ENGRAM-1.2.3-x64.dmg",
  "ENGRAM Setup 1.2.3-x64.exe",
  "latest.yml",
  "latest-linux.yml",
  "latest-mac.yml",
];

describe("release asset gate", () => {
  it("accepts a complete draft release", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames,
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it.each(
    RELEASE_TARGETS.flatMap((target) =>
      target.requiredAssets.map((asset) => ({ target, asset })),
    ),
  )("rejects a draft missing the $asset.label", ({ asset }) => {
    const assetNames = completeAssetNames.filter((name) =>
      "name" in asset ? name === asset.name : name.endsWith(asset.suffix),
    );
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames.filter((name) => name !== assetNames[0]),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain(asset.label);
  });

  it("rejects a complete asset list when the draft release is missing", () => {
    const result = validateReleaseAssets({
      releaseId: null,
      assetNames: completeAssetNames,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["draft release"]);
  });

  it("does not let an arm64 installer satisfy the x64 target", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames.map((name) =>
        name.replace(/-x64(?=\.)/, "-arm64"),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Linux x64 AppImage");
    expect(result.missing).toContain("Windows x64 installer");
  });
});
