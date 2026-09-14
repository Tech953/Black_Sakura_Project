import { readFileSync } from "node:fs";

export const REQUIRED_RELEASE_ASSETS = [
  { label: "Linux AppImage", pattern: /\.AppImage$/ },
  { label: "Linux deb package", pattern: /\.deb$/ },
  { label: "macOS DMG", pattern: /\.dmg$/ },
  { label: "Windows installer", pattern: /\.exe$/ },
  { label: "Windows update manifest", pattern: /^latest\.yml$/ },
  { label: "Linux update manifest", pattern: /^latest-linux\.yml$/ },
  { label: "macOS update manifest", pattern: /^latest-mac\.yml$/ },
];

export function validateReleaseAssets({ releaseId, assetNames }) {
  const normalizedReleaseId =
    typeof releaseId === "string" && releaseId.trim() !== ""
      ? releaseId.trim()
      : null;
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
  for (const asset of REQUIRED_RELEASE_ASSETS) {
    if (!normalizedAssetNames.some((name) => asset.pattern.test(name))) {
      missing.push(asset.label);
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
