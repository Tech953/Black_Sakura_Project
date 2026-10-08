import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  LLAMA_RUNTIME_ASSETS,
  LLAMA_VERSION,
} from "./llama-runtime-metadata.mjs";

const workflow = readFileSync(
  resolve(import.meta.dirname, "../../../.github/workflows/desktop-build.yml"),
  "utf8",
);

describe("pinned llama runtime metadata", () => {
  it("keeps each native contract target and checksum aligned with the pinned assets", () => {
    const contractStart = workflow.indexOf("\n  llama-runtime-contract:");
    const contractEnd = workflow.indexOf("\n  pre-release-smoke:", contractStart);
    expect(contractStart).toBeGreaterThanOrEqual(0);
    expect(contractEnd).toBeGreaterThan(contractStart);
    const contract = workflow.slice(contractStart, contractEnd);
    const rows = [
      ...contract.matchAll(
        /^[ \t]*- os: [^\r\n]+\r?\n[ \t]+platform: ([^\r\n]+)\r?\n[ \t]+arch: ([^\r\n]+)\r?\n[ \t]+sha256: ([a-f0-9]{64})$/gm,
      ),
    ].map(([, platform, architecture, sha256]) => ({
      platform,
      architecture,
      sha256,
    }));

    expect(
      rows
        .map(({ platform, architecture }) => `${platform}-${architecture}`)
        .sort(),
    ).toEqual(["darwin-arm64", "darwin-x64", "linux-arm64"]);
    for (const { platform, architecture, sha256 } of rows) {
      expect(LLAMA_RUNTIME_ASSETS[`${platform}-${architecture}`]?.sha256).toBe(
        sha256,
      );
    }
    expect(
      contract.match(/LLAMA_TARGET: \$\{\{\s*matrix\.platform\s*\}\}/g),
    ).toHaveLength(2);
    expect(
      contract.match(/LLAMA_ARCH: \$\{\{\s*matrix\.arch\s*\}\}/g),
    ).toHaveLength(2);
  });

  it("keeps every llama runtime workflow cache key aligned with pinned metadata", () => {
    const cacheKeys = [
      ...workflow.matchAll(/^[ \t]+key: (llama-runtime-[^\r\n]+)$/gm),
    ].map(([, key]) => key);
    const expectedMatrixKey =
      "llama-runtime-${{ matrix.platform }}-${{ matrix.arch }}-" +
      `${LLAMA_VERSION}-\${{ matrix.sha256 }}`;

    expect(cacheKeys).toContain(expectedMatrixKey);

    const literalKeys = cacheKeys.filter((key) => !key.includes("${{"));
    expect(literalKeys).toHaveLength(1);
    for (const key of literalKeys) {
      const match = key.match(
        /^llama-runtime-(linux|darwin|win32)-(x64|arm64)-([^-]+)-([a-f0-9]{64})$/,
      );
      expect(match, `invalid llama runtime cache key: ${key}`).not.toBeNull();
      const [, platform, architecture, version, sha256] = match;
      expect(version).toBe(LLAMA_VERSION);
      expect(LLAMA_RUNTIME_ASSETS[`${platform}-${architecture}`]?.sha256).toBe(
        sha256,
      );
    }
  });
});
