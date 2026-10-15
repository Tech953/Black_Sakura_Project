import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseFontconfigCharset,
  validateWebExportFontUnicodeCoverage,
  REQUIRED_UNICODE_FONT_COVERAGE,
} from "./check-font-unicode-coverage.mjs";
import { WEB_EXPORT_FONT_ASSETS } from "./check-web-export-font-assets.mjs";

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "engram-font-coverage-"));
  mkdirSync(path.join(root, "assets", "fonts"), { recursive: true });
  mkdirSync(path.join(root, "lib"), { recursive: true });
  for (const asset of WEB_EXPORT_FONT_ASSETS) {
    writeFileSync(path.join(root, "assets", "fonts", asset.file), "woff2");
  }
  const source = WEB_EXPORT_FONT_ASSETS.map(
    ({ family, file, importName }) =>
      `import ${importName} from "../assets/fonts/${file}";\n` +
      `"${family}": { uri: ${importName} },\n`,
  ).join("");
  const stack = WEB_EXPORT_FONT_ASSETS.map(({ family }) => `"${family}"`).join(", ");
  writeFileSync(
    path.join(root, "lib", "web-chat-export.ts"),
    `${source}export const BROWSER_UNICODE_FONT_STACK = ${stack}`,
  );
  return root;
}

test("parses single code points and inclusive fontconfig ranges", () => {
  const ranges = parseFontconfigCharset("20 3a9 900-97f 1f00-1fff");
  assert.deepEqual(ranges, [
    { start: 0x20, end: 0x20 },
    { start: 0x3a9, end: 0x3a9 },
    { start: 0x900, end: 0x97f },
    { start: 0x1f00, end: 0x1fff },
  ]);
});

test("validates representative coverage in every required script", () => {
  const root = makeFixture();
  try {
    const results = validateWebExportFontUnicodeCoverage({
      root,
      queryCharset: (filePath) => {
        const requirement = REQUIRED_UNICODE_FONT_COVERAGE.find(({ file }) =>
          filePath.endsWith(file),
        );
        assert.ok(requirement);
        return requirement.codePoints
          .map(({ codePoint }) => codePoint.toString(16))
          .join(" ");
      },
    });
    assert.equal(results.length, REQUIRED_UNICODE_FONT_COVERAGE.length);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("names the font family, file, and missing code point", () => {
  const root = makeFixture();
  const target = REQUIRED_UNICODE_FONT_COVERAGE.find(({ family }) =>
    family.endsWith("Greek"),
  );
  assert.ok(target);
  const missing = target.codePoints[1];

  try {
    assert.throws(
      () =>
        validateWebExportFontUnicodeCoverage({
          root,
          queryCharset: (filePath) =>
            filePath.endsWith(target.file)
              ? target.codePoints
                  .filter(({ codePoint }) => codePoint !== missing.codePoint)
                  .map(({ codePoint }) => codePoint.toString(16))
                  .join(" ")
              : "20",
        }),
      new RegExp(
        `font family "${target.family}".*assets/fonts/${target.file}.*U\\+${missing.codePoint
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}.*${missing.name}`,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});