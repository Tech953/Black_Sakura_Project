import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import test from "node:test";
import os from "node:os";
import path from "node:path";

import {
  validateWebExportFontAssets,
  WEB_EXPORT_FONT_ASSETS,
} from "./check-web-export-font-assets.mjs";

function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "engram-web-font-assets-"));
  mkdirSync(path.join(root, "assets", "fonts"), { recursive: true });
  for (const asset of WEB_EXPORT_FONT_ASSETS) {
    writeFileSync(path.join(root, "assets", "fonts", asset.file), "woff2");
  }
  const source = WEB_EXPORT_FONT_ASSETS.map(
    ({ family, file, importName }) =>
      `import ${importName} from "../assets/fonts/${file}";\n` +
      `"${family}": { uri: ${importName} },\n`,
  ).join("");
  const stack = WEB_EXPORT_FONT_ASSETS.map(({ family }) => `"${family}"`).join(", ");
  return {
    root,
    source: `${source}export const BROWSER_UNICODE_FONT_STACK = ${stack}`,
  };
}

test("validates every bundled font file and web export wiring", () => {
  const fixture = makeFixture();
  try {
    const assets = validateWebExportFontAssets(fixture);
    assert.equal(assets.length, WEB_EXPORT_FONT_ASSETS.length);
    assert.ok(assets.every((asset) => asset.bytes > 0));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("names the missing font family and file", () => {
  const fixture = makeFixture();
  const missing = WEB_EXPORT_FONT_ASSETS.find(({ family }) =>
    family.endsWith("Hebrew"),
  );
  assert.ok(missing);
  rmSync(path.join(fixture.root, "assets", "fonts", missing.file));

  try {
    assert.throws(
      () => validateWebExportFontAssets(fixture),
      new RegExp(
        `Missing Unicode PDF font family "${missing.family}" file "assets/fonts/${missing.file}"`,
      ),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});