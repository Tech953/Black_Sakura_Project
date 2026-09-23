/// <reference types="node" />

import {
  execFileSync,
} from "node:child_process";
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

export const PPTX_DELIVERY_LIMIT_BYTES = 200_000_000;
export const MAX_RASTER_WIDTH = 1920;
export const MAX_RASTER_HEIGHT = 1080;

type Relationship = {
  id: string;
  target: string;
  external: boolean;
};

export type PptxOptimizationResult = {
  inputPath: string;
  outputPath: string;
  inputSize: number;
  outputSize: number;
  optimizedAssetCount: number;
  slideCount: number;
};

function fail(message: string): never {
  throw new Error(message);
}

function run(command: string, args: Array<string>, cwd?: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr).trim()
        : "";
    throw new Error(
      `${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }
}

function runMagick(args: Array<string>): string {
  try {
    return run(process.env.MAGICK_BIN ?? "magick", args);
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new Error(
        "PPTX optimization needs ImageMagick (magick). Install it or set MAGICK_BIN to its executable path.",
      );
    }
    throw error;
  }
}

function walkFiles(root: string, current = root): Array<string> {
  return readdirSync(current).flatMap((entry) => {
    const absolutePath = path.join(current, entry);
    if (lstatSync(absolutePath).isDirectory()) {
      return walkFiles(root, absolutePath);
    }
    return [path.relative(root, absolutePath).split(path.sep).join("/")];
  });
}

function filePath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

function readRequired(root: string, relativePath: string): string {
  const absolutePath = filePath(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`PPTX structure is missing ${relativePath}.`);
  }
  return readFileSync(absolutePath, "utf8");
}

function xmlTags(xml: string, elementName: string): Array<string> {
  return [...xml.matchAll(new RegExp(`<${elementName}\\b[^>]*>`, "g"))].map(
    ([tag]) => tag,
  );
}

function xmlAttribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name.replace(":", "\\:")}="([^"]*)"`).exec(tag)?.[1];
}

function relationships(root: string, relativePath: string): Array<Relationship> {
  const xml = readRequired(root, relativePath);
  return xmlTags(xml, "Relationship").map((tag) => {
    const id = xmlAttribute(tag, "Id");
    const target = xmlAttribute(tag, "Target");
    if (!id || !target) {
      fail(`Invalid relationship in ${relativePath}.`);
    }
    return {
      id,
      target,
      external: xmlAttribute(tag, "TargetMode") === "External",
    };
  });
}

function relationshipSource(relativePath: string): string {
  const parts = relativePath.split("/");
  const relsDirectory = parts.slice(0, -1).join("/");
  const relsFilename = parts.at(-1);
  if (!relsFilename?.endsWith(".rels")) {
    fail(`Invalid relationship part ${relativePath}.`);
  }
  const sourceFilename = relsFilename.slice(0, -".rels".length);
  if (relsDirectory === "_rels") {
    return sourceFilename;
  }
  if (!relsDirectory.endsWith("/_rels")) {
    fail(`Invalid relationship part location ${relativePath}.`);
  }
  return `${relsDirectory.slice(0, -"/_rels".length)}/${sourceFilename}`;
}

function resolveTarget(sourcePart: string, target: string): string {
  if (target.startsWith("/")) {
    return target.slice(1);
  }
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePart), target),
  );
}

function assertInternalRelationships(root: string): void {
  for (const relativePath of walkFiles(root).filter((name) =>
    name.endsWith(".rels"),
  )) {
    const sourcePart = relationshipSource(relativePath);
    for (const relationship of relationships(root, relativePath)) {
      if (relationship.external) continue;
      const target = resolveTarget(sourcePart, relationship.target);
      if (!existsSync(filePath(root, target))) {
        fail(
          `PPTX relationship ${relativePath}:${relationship.id} points to missing ${target}.`,
        );
      }
    }
  }
}

function slideOrder(root: string): Array<string> {
  const presentation = readRequired(root, "ppt/presentation.xml");
  const presentationRelationships = new Map(
    relationships(root, "ppt/_rels/presentation.xml.rels").map((relationship) => [
      relationship.id,
      relationship,
    ]),
  );
  const order = xmlTags(presentation, "p:sldId").map((tag) => {
    const relationshipId = xmlAttribute(tag, "r:id");
    if (!relationshipId) {
      fail("A slide entry is missing its presentation relationship ID.");
    }
    const relationship = presentationRelationships.get(relationshipId);
    if (!relationship || relationship.external) {
      fail(`Slide entry ${relationshipId} has no internal relationship.`);
    }
    const target = resolveTarget("ppt/presentation.xml", relationship.target);
    if (!target.startsWith("ppt/slides/") || !target.endsWith(".xml")) {
      fail(`Slide entry ${relationshipId} does not target a slide XML part.`);
    }
    return target;
  });
  if (order.length === 0) {
    fail("PPTX presentation contains no slides.");
  }
  return order;
}

function assertSlideMediaReferences(root: string, slides: Array<string>): void {
  for (const slide of slides) {
    const slideXml = readRequired(root, slide);
    const relationshipPath = `${path.posix.dirname(slide)}/_rels/${path.posix.basename(slide)}.rels`;
    const slideRelationships = new Map(
      relationships(root, relationshipPath).map((relationship) => [
        relationship.id,
        relationship,
      ]),
    );
    for (const tag of [...xmlTags(slideXml, "a:blip"), ...xmlTags(slideXml, "a:hlinkClick")]) {
      const relationshipId =
        xmlAttribute(tag, "r:embed") ?? xmlAttribute(tag, "r:id");
      if (relationshipId && !slideRelationships.has(relationshipId)) {
        fail(`${slide} references missing relationship ${relationshipId}.`);
      }
    }
  }
}

export function validatePptxDirectory(root: string): {
  fileCount: number;
  slideOrder: Array<string>;
} {
  const files = walkFiles(root);
  const order = slideOrder(root);
  assertInternalRelationships(root);
  assertSlideMediaReferences(root, order);
  return { fileCount: files.length, slideOrder: order };
}

function archiveSize(archivePath: string): number {
  return statSync(archivePath).size;
}

function extractArchive(archivePath: string, destination: string): void {
  run("unzip", ["-q", archivePath, "-d", destination]);
}

function zipDirectory(source: string, archivePath: string): void {
  mkdirSync(path.dirname(archivePath), { recursive: true });
  run("zip", ["-q", "-r", archivePath, "."], source);
}

function archiveMediaFiles(root: string): Array<string> {
  return walkFiles(root).filter(
    (relativePath) =>
      relativePath.startsWith("ppt/media/") &&
      /\.(?:png|jpe?g|gif|webp)$/i.test(relativePath),
  );
}

function rasterDimensions(absolutePath: string): { width: number; height: number } {
  const output = runMagick(["identify", "-format", "%w %h", absolutePath]).trim();
  const [widthText, heightText] = output.split(/\s+/);
  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    fail(`ImageMagick could not read raster dimensions for ${absolutePath}.`);
  }
  return { width, height };
}

function optimizeRaster(absolutePath: string): boolean {
  const { width, height } = rasterDimensions(absolutePath);
  if (width <= MAX_RASTER_WIDTH && height <= MAX_RASTER_HEIGHT) {
    return false;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const temporaryPath = `${absolutePath}.optimized${extension}`;
  const args = [
    absolutePath,
    "-resize",
    `${MAX_RASTER_WIDTH}x${MAX_RASTER_HEIGHT}>`,
  ];
  if (extension === ".png") {
    args.push("-define", "png:compression-level=9");
  } else if (extension === ".jpg" || extension === ".jpeg") {
    args.push("-strip", "-quality", "88");
  }
  args.push(temporaryPath);
  runMagick(args);
  renameSync(temporaryPath, absolutePath);
  return true;
}

function hashFile(absolutePath: string): string {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function assertSameNonMediaFiles(
  beforeRoot: string,
  afterRoot: string,
): void {
  const before = walkFiles(beforeRoot);
  const after = walkFiles(afterRoot);
  if (before.join("\n") !== after.join("\n")) {
    fail("PPTX optimization changed the archive file list.");
  }
  for (const relativePath of before) {
    if (relativePath.startsWith("ppt/media/")) continue;
    if (
      hashFile(filePath(beforeRoot, relativePath)) !==
      hashFile(filePath(afterRoot, relativePath))
    ) {
      fail(`PPTX optimization changed non-media part ${relativePath}.`);
    }
  }
}

export function deliveryLimitMessage(outputPath: string, outputSize: number): string {
  return [
    `Optimized PPTX ${outputPath} is ${Math.ceil(outputSize / 1_000_000)} MB, above the ${Math.floor(PPTX_DELIVERY_LIMIT_BYTES / 1_000_000)} MB delivery limit.`,
    "Reduce the number or visual density of full-slide raster layers, or export a smaller slide subset.",
  ].join(" ");
}

export function optimizePptx(inputPath: string, outputPath: string): PptxOptimizationResult {
  const absoluteInput = path.resolve(inputPath);
  const absoluteOutput = path.resolve(outputPath);
  if (!existsSync(absoluteInput) || !lstatSync(absoluteInput).isFile()) {
    fail(`Input PPTX does not exist: ${absoluteInput}`);
  }
  if (absoluteInput === absoluteOutput) {
    fail("Input and output PPTX paths must be different.");
  }

  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "engram-pptx-"));
  const beforeRoot = path.join(temporaryRoot, "before");
  const afterRoot = path.join(temporaryRoot, "after");
  mkdirSync(beforeRoot);
  mkdirSync(afterRoot);
  try {
    extractArchive(absoluteInput, beforeRoot);
    const beforeValidation = validatePptxDirectory(beforeRoot);
    const rasterCache = new Map<
      string,
      { optimized: boolean; content?: Buffer }
    >();
    const optimizedAssets = archiveMediaFiles(beforeRoot).filter((relativePath) => {
      const absolutePath = filePath(beforeRoot, relativePath);
      const sourceHash = hashFile(absolutePath);
      const cached = rasterCache.get(sourceHash);
      if (cached) {
        if (cached.optimized && cached.content) {
          writeFileSync(absolutePath, cached.content);
        }
        return cached.optimized;
      }

      const optimized = optimizeRaster(absolutePath);
      rasterCache.set(sourceHash, {
        optimized,
        content: optimized ? readFileSync(absolutePath) : undefined,
      });
      return optimized;
    });
    zipDirectory(beforeRoot, absoluteOutput);
    extractArchive(absoluteOutput, afterRoot);
    const afterValidation = validatePptxDirectory(afterRoot);
    assertSameNonMediaFiles(beforeRoot, afterRoot);
    if (
      beforeValidation.slideOrder.join("\n") !==
      afterValidation.slideOrder.join("\n")
    ) {
      fail("PPTX optimization changed slide order.");
    }

    const outputSize = archiveSize(absoluteOutput);
    if (outputSize > PPTX_DELIVERY_LIMIT_BYTES) {
      rmSync(absoluteOutput, { force: true });
      fail(deliveryLimitMessage(absoluteOutput, outputSize));
    }
    return {
      inputPath: absoluteInput,
      outputPath: absoluteOutput,
      inputSize: archiveSize(absoluteInput),
      outputSize,
      optimizedAssetCount: optimizedAssets.length,
      slideCount: afterValidation.slideOrder.length,
    };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const cliArguments = process.argv.slice(2);
  if (cliArguments[0] === "--") cliArguments.shift();
  const [inputPath, outputPath] = cliArguments;
  if (!inputPath || !outputPath) {
    console.error(
      "Usage: pnpm run optimize-pptx -- <exported.pptx> <optimized-output.pptx>",
    );
    process.exitCode = 2;
  } else {
    try {
      const result = optimizePptx(inputPath, outputPath);
      console.log(
        `Optimized ${result.optimizedAssetCount} raster assets across ${result.slideCount} slides: ${formatSize(result.inputSize)} -> ${formatSize(result.outputSize)}.`,
      );
      console.log(`Validated PPTX structure and wrote ${result.outputPath}.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}