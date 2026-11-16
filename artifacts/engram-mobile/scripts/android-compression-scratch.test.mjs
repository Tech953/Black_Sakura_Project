import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareCompressionScratch } from "./android-compression-scratch.mjs";

test("redirects only compressed assets and can be safely reused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "android-scratch-test-"));
  try {
    const options = { buildDir: path.join(root, "build"), scratch: path.join(root, "scratch"), minimumBytes: 0 };
    const result = await prepareCompressionScratch(options);
    await writeFile(path.join(result.link, "probe"), "asset");
    assert.equal(await readFile(path.join(options.scratch, "probe"), "utf8"), "asset");
    assert.equal((await prepareCompressionScratch(options)).target, options.scratch);
    await assert.rejects(prepareCompressionScratch({ ...options, scratch: path.join(root, "other") }), /Refusing/);
    const apk = await prepareCompressionScratch({ ...options, scratch: path.join(root, "apk"), apk: true });
    assert.equal(apk.link, path.join(options.buildDir, "outputs/apk/deviceLocal"));
    await writeFile(path.join(apk.link, "candidate.apk"), "candidate");
    assert.equal(await readFile(path.join(root, "apk/candidate.apk"), "utf8"), "candidate");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("preserves existing output and rejects unsafe or undersized scratch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "android-scratch-test-"));
  try {
    const buildDir = path.join(root, "build");
    const output = path.join(buildDir, "intermediates/compressed_assets");
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "keep"), "original");
    const options = { buildDir, scratch: path.join(root, "scratch"), minimumBytes: 0 };
    await assert.rejects(prepareCompressionScratch(options), /Refusing/);
    assert.equal(await readFile(path.join(output, "keep"), "utf8"), "original");
    await assert.rejects(prepareCompressionScratch({ ...options, scratch: path.join(buildDir, "nested") }), /outside/);
    await assert.rejects(prepareCompressionScratch({ ...options, minimumBytes: Number.MAX_SAFE_INTEGER }), /Scratch needs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
