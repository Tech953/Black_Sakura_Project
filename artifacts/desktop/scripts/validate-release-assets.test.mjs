import { describe, expect, it } from "vitest";
import {
  REQUIRED_RELEASE_ASSETS,
  validateReleaseAssets,
} from "./validate-release-assets.mjs";

const completeAssetNames = [
  "ENGRAM-1.2.3.AppImage",
  "engram_1.2.3_amd64.deb",
  "ENGRAM-1.2.3.dmg",
  "ENGRAM Setup 1.2.3.exe",
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

  it.each(REQUIRED_RELEASE_ASSETS)(
    "rejects a draft missing the $label",
    ({ pattern, label }) => {
      const assetNames = completeAssetNames.filter((name) =>
        pattern.test(name),
      );
      const result = validateReleaseAssets({
        releaseId: "release-123",
        assetNames: completeAssetNames.filter((name) => name !== assetNames[0]),
      });

      expect(result.ok).toBe(false);
      expect(result.missing).toContain(label);
    },
  );

  it("rejects a complete asset list when the draft release is missing", () => {
    const result = validateReleaseAssets({
      releaseId: null,
      assetNames: completeAssetNames,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["draft release"]);
  });
});
