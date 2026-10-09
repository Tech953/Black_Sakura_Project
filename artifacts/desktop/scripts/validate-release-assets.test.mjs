import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendReleaseAssetsSummary,
  RELEASE_TARGETS,
  validateReleaseAssets,
} from "./validate-release-assets.mjs";

const workflow = readFileSync(
  new URL("../../../.github/workflows/desktop-build.yml", import.meta.url),
  "utf8",
);
const desktopBuildJob =
  workflow
    .split("\n  build:\n")[1]
    ?.split("\n  llama-runtime-contract:\n")[0] ?? "";
const electronBuilderConfig = readFileSync(
  new URL("../electron-builder.yml", import.meta.url),
  "utf8",
);
const releaseTag = "v1.2.3";
const expectedAndroidApk = "ENGRAM-Mobile-1.2.3.apk";
const completeAssetNames = [
  "ENGRAM-1.2.3-x64.AppImage",
  "engram_1.2.3-x64.deb",
  "ENGRAM-1.2.3-x64.dmg",
  "ENGRAM-1.2.3-x64.zip",
  "ENGRAM-1.2.3-arm64.dmg",
  "ENGRAM-1.2.3-arm64.zip",
  "ENGRAM Setup 1.2.3-x64.exe",
  "latest.yml",
  "latest-linux.yml",
  "latest-mac.yml",
  expectedAndroidApk,
];
const manifestFileUrls = {
  "latest-linux.yml": ["ENGRAM-1.2.3-x64.AppImage"],
  "latest-mac.yml": ["ENGRAM-1.2.3-x64.zip", "ENGRAM-1.2.3-arm64.zip"],
  "latest.yml": ["ENGRAM Setup 1.2.3-x64.exe"],
};

function createManifest(fileUrls) {
  return [
    "version: 1.2.3",
    "files:",
    ...fileUrls.map((url) => `  - url: ${JSON.stringify(url)}`),
    "releaseDate: '2026-10-08T12:00:00.000Z'",
  ].join("\n");
}

const completeManifestContents = Object.fromEntries(
  Object.entries(manifestFileUrls).map(([name, urls]) => [
    name,
    createManifest(urls),
  ]),
);

function validateCompleteRelease(overrides = {}) {
  return validateReleaseAssets({
    releaseId: "release-123",
    assetNames: completeAssetNames,
    tag: releaseTag,
    manifestContents: completeManifestContents,
    ...overrides,
  });
}

function createSummary(result, tag = releaseTag) {
  const summaryDir = mkdtempSync(join(tmpdir(), "release-assets-summary-"));
  const summaryPath = join(summaryDir, "summary.md");
  try {
    appendReleaseAssetsSummary(summaryPath, { tag, result });
    return readFileSync(summaryPath, "utf8");
  } finally {
    rmSync(summaryDir, { recursive: true, force: true });
  }
}

describe("release asset gate", () => {
  it("accepts a complete draft release", () => {
    const result = validateCompleteRelease();

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it.each(
    RELEASE_TARGETS.flatMap((target) =>
      target.requiredAssets.flatMap((asset) =>
        (asset.manifestEntries ?? []).map((entry) => ({ asset, entry })),
      ),
    ),
  )("rejects a manifest missing $entry.label", ({ asset, entry }) => {
    const manifestContents = { ...completeManifestContents };
    manifestContents[asset.name] = createManifest(
      manifestFileUrls[asset.name].filter((url) => !url.endsWith(entry.suffix)),
    );
    const result = validateCompleteRelease({ manifestContents });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain(entry.label);
  });

  it("requires manifest update URLs to name assets present in the draft", () => {
    const manifestContents = {
      ...completeManifestContents,
      "latest-mac.yml": createManifest([
        "ENGRAM-1.2.3-x64.zip",
        "ENGRAM-1.2.3-arm64.zip",
      ]),
    };
    const result = validateCompleteRelease({
      assetNames: completeAssetNames.filter(
        (name) => name !== "ENGRAM-1.2.3-arm64.zip",
      ),
      manifestContents,
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("macOS arm64 update archive");
  });

  it.each(
    RELEASE_TARGETS.flatMap((target) =>
      target.requiredAssets.map((asset) => ({ target, asset })),
    ),
  )("rejects a draft missing the $asset.label", ({ asset }) => {
    const assetNames = completeAssetNames.filter((name) =>
      "name" in asset ? name === asset.name : name.endsWith(asset.suffix),
    );
    const result = validateCompleteRelease({
      assetNames: completeAssetNames.filter((name) => name !== assetNames[0]),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain(asset.label);
  });

  it("rejects a complete asset list when the draft release is missing", () => {
    const result = validateCompleteRelease({ releaseId: null });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(["draft release"]);
  });

  it("rejects a release missing its tag-versioned Android APK", () => {
    const result = validateCompleteRelease({
      assetNames: completeAssetNames.filter(
        (name) => name !== expectedAndroidApk,
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Android signed APK");
  });

  it("does not let an APK for another version satisfy the release", () => {
    const result = validateCompleteRelease({
      assetNames: completeAssetNames
        .filter((name) => name !== expectedAndroidApk)
        .concat("ENGRAM-Mobile-1.2.2.apk"),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Android signed APK");
  });

  it("writes a success summary with fixed labels and release metadata", () => {
    const result = validateCompleteRelease();
    const summary = createSummary(result);

    expect(summary).toContain("- Tag: v1.2.3");
    expect(summary).toContain("- Draft release ID: release-123");
    expect(summary).toContain("- Asset count: 11");
    expect(summary).toContain("- Result: passed");
    expect(summary).toContain("### Required assets present");
    expect(summary).toContain("- Android signed APK");
    expect(summary).toContain("- Missing requirements: none");
    expect(summary).not.toContain("ENGRAM-1.2.3-x64.AppImage");
  });

  it("summarizes missing labels without copying unbounded API asset data", () => {
    const sensitiveApiValue = `FAKE_GH_TOKEN_SECRET_SENTINEL${"x".repeat(16_384)}`;
    const result = validateCompleteRelease({
      assetNames: completeAssetNames
        .filter((name) => name !== expectedAndroidApk)
        .concat(sensitiveApiValue),
    });
    const summary = createSummary(result);

    expect(summary).toContain("- Tag: v1.2.3");
    expect(summary).toContain("- Draft release ID: release-123");
    expect(summary).toContain("- Asset count: 11");
    expect(summary).toContain("- Result: failed");
    expect(summary).toContain("- Android signed APK");
    expect(summary).not.toContain("FAKE_GH_TOKEN_SECRET_SENTINEL");
    expect(summary).not.toContain(sensitiveApiValue);
    expect(summary.length).toBeLessThan(2000);
  });

  it("does not let an arm64 installer satisfy the x64 target", () => {
    const result = validateCompleteRelease({
      assetNames: completeAssetNames.map((name) =>
        name.replace(/-x64(?=\.)/, "-arm64"),
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain("Linux x64 AppImage");
    expect(result.missing).toContain("macOS x64 DMG");
    expect(result.missing).toContain("Windows x64 installer");
  });

  it("requires distinct macOS x64 and arm64 installers", () => {
    const withoutArm64 = validateCompleteRelease({
      assetNames: completeAssetNames.filter(
        (name) => name !== "ENGRAM-1.2.3-arm64.dmg",
      ),
    });
    const withoutX64 = validateCompleteRelease({
      assetNames: completeAssetNames.filter(
        (name) => name !== "ENGRAM-1.2.3-x64.dmg",
      ),
    });

    expect(withoutArm64.missing).toContain("macOS arm64 DMG");
    expect(withoutX64.missing).toContain("macOS x64 DMG");
  });

  it("keeps signed macOS arm64 packaging in the tagged release matrix", () => {
    expect(desktopBuildJob).toMatch(
      /- os: macos-14\s+platform: mac\s+arch: arm64/,
    );
    expect(electronBuilderConfig).toContain(
      "artifactName: ${productName}-${version}-${arch}.${ext}",
    );
    expect(electronBuilderConfig).toMatch(/^mac:\s+target:\s+- dmg$/m);
    expect(electronBuilderConfig).toContain("notarize: true");
    expect(desktopBuildJob).toContain(
      "if: github.event_name == 'push' && github.ref_type == 'tag' && matrix.platform != 'linux'",
    );
    expect(desktopBuildJob).toContain("CSC_LINK: ${{ secrets.CSC_LINK }}");
    expect(desktopBuildJob).toContain("APPLE_ID: ${{ secrets.APPLE_ID }}");
    expect(desktopBuildJob).toContain(
      "- name: Verify macOS signature and notarization",
    );
    expect(desktopBuildJob).toContain("if: matrix.platform == 'mac'");
    expect(desktopBuildJob).toContain('EXPECTED_ARCH="${{ matrix.arch }}"');
    expect(desktopBuildJob).toContain(
      "run: pnpm --filter @workspace/desktop exec electron-builder --${{ matrix.platform }} --${{ matrix.arch }}",
    );
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
    const checkoutIndex = publishJob.indexOf("actions/checkout@v4");
    const publishCondition = publishJob.match(/^\s*if: ([^\n]+)/m)?.[1] ?? "";
    const publishApiCallIndex = publishJob.indexOf(
      'gh api -X PATCH "repos/$REPO/releases/$RELEASE_ID"',
    );

    expect(publishCondition).toContain("github.event_name == 'push'");
    expect(publishCondition).toContain("github.ref_type == 'tag'");
    expect(publishCondition).not.toContain("workflow_dispatch");
    expect(verifyStepIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeGreaterThanOrEqual(0);
    expect(checkoutIndex).toBeLessThan(verifyStepIndex);
    expect(unDraftStepIndex).toBeGreaterThan(verifyStepIndex);
    expect(publishApiCallIndex).toBeGreaterThan(unDraftStepIndex);
    expect(verifyStep).toContain("set -euo pipefail");
    expect(verifyStep).toContain("TAG: ${{ github.ref_name }}");
    expect(verifyStep).toContain('TAG="$TAG"');
    expect(verifyStep).toContain(
      "node artifacts/desktop/scripts/validate-release-assets.mjs",
    );
    expect(verifyStep).toContain("Accept: application/octet-stream");
    expect(verifyStep).toContain('RELEASE_MANIFEST_DIR="$MANIFEST_DIR"');
    for (const asset of RELEASE_TARGETS.flatMap((target) =>
      target.requiredAssets.filter((candidate) => candidate.manifestEntries),
    )) {
      expect(verifyStep).toContain(asset.name);
    }
  });
});
