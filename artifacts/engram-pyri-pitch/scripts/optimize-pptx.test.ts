import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_RASTER_HEIGHT,
  MAX_RASTER_WIDTH,
  optimizePptx,
  validatePptxDirectory,
} from "./optimize-pptx";

function createFixture(): { inputPath: string; outputPath: string } {
  const directory = mkdtempSync(path.join(os.tmpdir(), "engram-pptx-test-"));
  const root = path.join(directory, "root");
  mkdirSync(path.join(root, "ppt/_rels"), { recursive: true });
  mkdirSync(path.join(root, "ppt/slides/_rels"), { recursive: true });
  mkdirSync(path.join(root, "ppt/media"), { recursive: true });
  writeFileSync(
    path.join(root, "ppt/presentation.xml"),
    '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
  );
  writeFileSync(
    path.join(root, "ppt/_rels/presentation.xml.rels"),
    '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
  );
  writeFileSync(
    path.join(root, "ppt/slides/slide1.xml"),
    '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><a:blip r:embed="rId1"/></p:sld>',
  );
  writeFileSync(
    path.join(root, "ppt/slides/_rels/slide1.xml.rels"),
    '<Relationships><Relationship Id="rId1" Target="../media/image1.png"/></Relationships>',
  );
  execFileSync("magick", [
    "-size",
    "3840x2160",
    "xc:rgba(12,34,56,0.5)",
    path.join(root, "ppt/media/image1.png"),
  ]);
  const inputPath = path.join(directory, "input.pptx");
  const outputPath = path.join(directory, "output.pptx");
  execFileSync("zip", ["-q", "-r", inputPath, "."], { cwd: root });
  return { inputPath, outputPath };
}

test("downsamples oversized PNGs, keeps alpha, and preserves slide structure", () => {
  const { inputPath, outputPath } = createFixture();
  try {
    const result = optimizePptx(inputPath, outputPath);

    assert.equal(result.optimizedAssetCount, 1);
    assert.equal(result.slideCount, 1);

    const extracted = mkdtempSync(path.join(os.tmpdir(), "engram-pptx-check-"));
    try {
      execFileSync("unzip", ["-q", outputPath, "-d", extracted]);
      assert.deepEqual(validatePptxDirectory(extracted).slideOrder, [
        "ppt/slides/slide1.xml",
      ]);
      const identify = execFileSync(
        "magick",
        [
          "identify",
          "-format",
          "%w %h %[channels]",
          path.join(extracted, "ppt/media/image1.png"),
        ],
        { encoding: "utf8" },
      );
      assert.match(
        identify,
        new RegExp(`${MAX_RASTER_WIDTH} ${MAX_RASTER_HEIGHT}`),
      );
      assert.match(identify, /a/);
    } finally {
      rmSync(extracted, { recursive: true, force: true });
    }
  } finally {
    rmSync(path.dirname(inputPath), { recursive: true, force: true });
  }
});