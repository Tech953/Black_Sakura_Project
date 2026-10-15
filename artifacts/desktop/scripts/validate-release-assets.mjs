import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_MANIFEST_BYTES = 256 * 1024;

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
      {
        label: "Linux x64 update manifest",
        name: "latest-linux.yml",
        manifestEntries: [
          { label: "Linux x64 updater file", suffix: "-x64.AppImage" },
        ],
      },
    ],
  },
  {
    id: "mac",
    requiredAssets: [
      { label: "macOS x64 DMG", suffix: "-x64.dmg" },
      { label: "macOS arm64 DMG", suffix: "-arm64.dmg" },
      {
        label: "macOS update manifest",
        name: "latest-mac.yml",
        manifestEntries: [
          { label: "macOS x64 update archive", suffix: "-x64.zip" },
          { label: "macOS arm64 update archive", suffix: "-arm64.zip" },
        ],
      },
    ],
  },
  {
    id: "win-x64",
    requiredAssets: [
      { label: "Windows x64 installer", suffix: "-x64.exe" },
      {
        label: "Windows x64 update manifest",
        name: "latest.yml",
        manifestEntries: [
          { label: "Windows x64 updater file", suffix: "-x64.exe" },
        ],
      },
    ],
  },
];

function parseYamlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'")) {
    return trimmed.endsWith("'")
      ? trimmed.slice(1, -1).replace(/''/g, "'")
      : null;
  }
  return trimmed || null;
}

function getManifestFileName(url) {
  try {
    const pathname = new URL(url, "https://release.invalid/").pathname;
    const encodedFileName = pathname.split("/").at(-1) ?? "";
    return decodeURIComponent(encodedFileName);
  } catch {
    return url.split(/[\\/]/).at(-1) ?? "";
  }
}

function parseManifestFileNames(contents) {
  if (
    typeof contents !== "string" ||
    Buffer.byteLength(contents, "utf8") > MAX_MANIFEST_BYTES
  ) {
    return [];
  }

  const lines = contents.split(/\r?\n/);
  const filesHeaderIndex = lines.findIndex((line) =>
    /^files:\s*(?:#.*)?$/.test(line),
  );
  if (filesHeaderIndex < 0) {
    return [];
  }

  const fileNames = [];
  for (const line of lines.slice(filesHeaderIndex + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) {
      break;
    }
    const match =
      line.match(/^\s*-\s+url:\s*(.*?)\s*$/) ??
      line.match(/^\s+url:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }
    const url = parseYamlString(match[1]);
    if (url) {
      fileNames.push(getManifestFileName(url));
    }
  }
  return fileNames;
}

function readManifestContents(manifestDir) {
  if (typeof manifestDir !== "string" || manifestDir.trim() === "") {
    return {};
  }

  const manifestNames = new Set(
    RELEASE_TARGETS.flatMap((target) =>
      target.requiredAssets
        .filter((asset) => asset.manifestEntries)
        .map((asset) => asset.name),
    ),
  );
  const contents = {};
  for (const name of manifestNames) {
    const filePath = join(manifestDir, name);
    try {
      if (statSync(filePath).size <= MAX_MANIFEST_BYTES) {
        contents[name] = readFileSync(filePath, "utf8");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return contents;
}

export function validateReleaseAssets({
  releaseId,
  assetNames,
  tag,
  manifestContents = {},
}) {
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
      if (assetPresent && asset.manifestEntries) {
        const manifestFileNames = parseManifestFileNames(
          manifestContents[asset.name],
        );
        for (const entry of asset.manifestEntries) {
          const entryPresent = manifestFileNames.some(
            (name) =>
              name.endsWith(entry.suffix) &&
              normalizedAssetNames.includes(name),
          );
          if (entryPresent) {
            passed.push(entry.label);
          } else {
            missing.push(entry.label);
          }
        }
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
    manifestContents: readManifestContents(process.env.RELEASE_MANIFEST_DIR),
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
