import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  RELEASE_TARGETS,
  validateReleaseAssets,
} from "./validate-release-assets.mjs";

const workflow = readFileSync(
  new URL("../../../.github/workflows/desktop-build.yml", import.meta.url),
  "utf8",
);
const releaseTag = "v1.2.3";
const expectedAndroidApk = "ENGRAM-Mobile-1.2.3.apk";
const completeAssetNames = [
  "ENGRAM-1.2.3-x64.AppImage",
  "engram_1.2.3-x64.deb",
  "ENGRAM-1.2.3-x64.dmg",
  "ENGRAM Setup 1.2.3-x64.exe",
  "latest.yml",
  "latest-linux.yml",
  "latest-mac.yml",
  expectedAndroidApk,
];

describe("release asset gate", () => {
  it("accepts a complete draft release", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames,
      tag: releaseTag,
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
      tag: releaseTag,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain(asset.label);
  });

  it("rejects a complete asset list when the draft release is missing", () => {
    const result = validateReleaseAssets({
      releaseId: null,
      assetNames: completeAssetNames,
      tag: releaseTag,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["draft release"]);
  });

  it("rejects a release missing its tag-versioned Android APK", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames.filter(
        (name) => name !== expectedAndroidApk,
      ),
      tag: releaseTag,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Android signed APK");
  });

  it("does not let an APK for another version satisfy the release", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames
        .filter((name) => name !== expectedAndroidApk)
        .concat("ENGRAM-Mobile-1.2.2.apk"),
      tag: releaseTag,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Android signed APK");
  });

  it("does not let an arm64 installer satisfy the x64 target", () => {
    const result = validateReleaseAssets({
      releaseId: "release-123",
      assetNames: completeAssetNames.map((name) =>
        name.replace(/-x64(?=\.)/, "-arm64"),
      ),
      tag: releaseTag,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Linux x64 AppImage");
    expect(result.missing).toContain("Windows x64 installer");
  });

  it("runs only for tag publication and validates assets before un-drafting", () => {
    const publishJob =
      workflow.split("\n  publish:\n")[1]?.split("\n  cleanup-draft:\n")[0] ??
      "";
    const verifyStepIndex = publishJob.indexOf(
      "- name: Verify draft release assets",
    );
    const unDraftStepIndex = publishJob.indexOf("- name: Un-draft the release");
    const verifyStep = publishJob.slice(verifyStepIndex, unDraftStepIndex);
    const publishCondition = publishJob.match(/^\s*if: ([^\n]+)/m)?.[1] ?? "";
    const publishApiCallIndex = publishJob.indexOf(
      'gh api -X PATCH "repos/$REPO/releases/$RELEASE_ID"',
    );

    expect(publishCondition).toContain("github.event_name == 'push'");
    expect(publishCondition).toContain("github.ref_type == 'tag'");
    expect(publishCondition).not.toContain("workflow_dispatch");
    expect(verifyStepIndex).toBeGreaterThanOrEqual(0);
    expect(unDraftStepIndex).toBeGreaterThan(verifyStepIndex);
    expect(publishApiCallIndex).toBeGreaterThan(unDraftStepIndex);
    expect(verifyStep).toContain("set -euo pipefail");
    expect(verifyStep).toContain("TAG: ${{ github.ref_name }}");
    expect(verifyStep).toContain('TAG="$TAG"');
    expect(verifyStep).toContain(
      "node artifacts/desktop/scripts/validate-release-assets.mjs",
    );
  });
});
