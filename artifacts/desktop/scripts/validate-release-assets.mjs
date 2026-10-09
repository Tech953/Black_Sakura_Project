import { appendFileSync, readFileSync } from "node:fs";

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
  const passed = [];

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
  } else {
    passed.push("Android signed APK");
  }
  for (const target of RELEASE_TARGETS) {
    for (const asset of target.requiredAssets) {
      const assetPresent = normalizedAssetNames.some((name) =>
        "name" in asset ? name === asset.name : name.endsWith(asset.suffix),
      );
      if (assetPresent) {
        passed.push(asset.label);
      } else {
        missing.push(asset.label);
      }
    }
  }

  return {
    ok: missing.length === 0,
    releaseId: normalizedReleaseId,
    assetNames: normalizedAssetNames,
    passed,
    missing,
  };
}

function boundedSummaryValue(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") {
    return fallback;
  }
  return value
    .trim()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 128);
}

export function formatReleaseAssetsSummary({ tag, result }) {
  const lines = [
    "## Release asset gate",
    "",
    `- Tag: ${boundedSummaryValue(tag, "unknown")}`,
    `- Draft release ID: ${boundedSummaryValue(result.releaseId, "unknown")}`,
    `- Asset count: ${result.assetNames.length}`,
    `- Result: ${result.ok ? "passed" : "failed"}`,
  ];

  lines.push(
    "",
    "### Required assets present",
    ...(result.passed.length > 0
      ? result.passed.map((label) => `- ${label}`)
      : ["- none"]),
  );

  if (result.missing.length > 0) {
    lines.push("", "### Missing requirements");
    lines.push(...result.missing.map((label) => `- ${label}`));
  } else {
    lines.push("", "- Missing requirements: none");
  }

  return `${lines.join("\n")}\n`;
}

export function appendReleaseAssetsSummary(summaryPath, { tag, result }) {
  if (typeof summaryPath !== "string" || summaryPath.trim() === "") {
    return;
  }
  appendFileSync(summaryPath, formatReleaseAssetsSummary({ tag, result }), {
    encoding: "utf8",
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const assetNames = readFileSync(0, "utf8").split(/\r?\n/);
  const tag = process.env.TAG;
  const result = validateReleaseAssets({
    releaseId: process.env.RELEASE_ID,
    assetNames,
    tag,
  });
  appendReleaseAssetsSummary(process.env.GITHUB_STEP_SUMMARY, {
    tag,
    result,
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
