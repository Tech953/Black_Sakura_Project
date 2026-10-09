import { readFileSync } from "node:fs";

// Every electron-builder target that can be published must declare its
// architecture-specific installer suffixes and updater manifest here. Adding a
// target to electron-builder.yml without adding it to this list leaves the
// release gate unaware of that target.
export const RELEASE_TARGETS = [
  {
    id: "linux-x64",
    requiredAssets: [
      { label: "Linux x64 AppImage", suffix: "-x64.AppImage" },
      { label: "Linux x64 deb package", suffix: "-x64.deb" },
      { label: "Linux x64 update manifest", name: "latest-linux.yml" },
    ],
  },
  {
    id: "mac-x64",
    requiredAssets: [
      { label: "macOS x64 DMG", suffix: "-x64.dmg" },
      { label: "macOS x64 update manifest", name: "latest-mac.yml" },
    ],
  },
  {
    id: "win-x64",
    requiredAssets: [
      { label: "Windows x64 installer", suffix: "-x64.exe" },
      { label: "Windows x64 update manifest", name: "latest.yml" },
    ],
  },
];

export function validateReleaseAssets({ releaseId, assetNames, tag }) {
  const normalizedReleaseId =
    typeof releaseId === "string" && releaseId.trim() !== ""
      ? releaseId.trim()
      : null;
  const normalizedTag =
    typeof tag === "string" && tag.trim() !== "" ? tag.trim() : null;
  const normalizedAssetNames = Array.from(
    new Set(
      assetNames
        .filter((name) => typeof name === "string")
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  );
  const missing = [];

  if (!normalizedReleaseId) {
    missing.push("draft release");
  }
  const apkVersion = normalizedTag?.replace(/^v/, "");
  if (!apkVersion) {
    missing.push("release tag");
  } else if (
    !normalizedAssetNames.includes(`ENGRAM-Mobile-${apkVersion}.apk`)
  ) {
    missing.push("Android signed APK");
  }
  for (const target of RELEASE_TARGETS) {
    for (const asset of target.requiredAssets) {
      const present = normalizedAssetNames.some((name) =>
        "name" in asset ? name === asset.name : name.endsWith(asset.suffix),
      );
      if (!present) {
        missing.push(asset.label);
      }
    }
  }

  return {
    ok: missing.length === 0,
    releaseId: normalizedReleaseId,
    assetNames: normalizedAssetNames,
    missing,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assetNames = readFileSync(0, "utf8").split(/\r?\n/);
  const result = validateReleaseAssets({
    releaseId: process.env.RELEASE_ID,
    assetNames,
    tag: process.env.TAG,
  });

  if (!result.ok) {
    console.error(
      `Release asset gate failed: missing ${result.missing.join(", ")}.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Release asset gate passed for draft ${result.releaseId}; ` +
        `${result.assetNames.length} assets found.`,
    );
  }
}
