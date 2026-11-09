import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { verifyRuntimeCandidate } from "./full-rezz-runtime-layout.mjs";
const required = [
  "python/python.exe",
  "models/manifest.json",
  "fonts/manifest.json",
  "vendor/espeak-ng/manifest.json",
  "vendor/llama-cpp/manifest.json",
];
async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "voice-runtime-layout-"));
  try {
    const files = [];
    for (const name of required) {
      const content = Buffer.from(name);
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), content);
      files.push({
        path: name,
        bytes: content.length,
        sha256: createHash("sha256").update(content).digest("hex"),
      });
    }
    const manifest = { runtimeProbePassed: true, files };
    await writeFile(
      path.join(root, "windows-runtime-manifest.json"),
      JSON.stringify(manifest),
    );
    await run(root, manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("native builder layout is accepted without an installer app wrapper", () =>
  fixture(async (root) => {
    const value = verifyRuntimeCandidate(root);
    assert.equal(value.appRoot, root);
    assert.equal(value.pythonRoot, path.join(root, "python"));
  }));
test("corrupt assets and unsuccessful probes fail closed", () =>
  fixture(async (root, m) => {
    await writeFile(path.join(root, "python/python.exe"), "tampered");
    assert.throws(() => verifyRuntimeCandidate(root), /checksum/);
    m.runtimeProbePassed = false;
    await writeFile(
      path.join(root, "windows-runtime-manifest.json"),
      JSON.stringify(m),
    );
    assert.throws(() => verifyRuntimeCandidate(root), /successful/);
  }));
test("incomplete, duplicate and unsafe inventories are rejected", () =>
  fixture(async (root, m) => {
    for (const files of [
      m.files.slice(1),
      [...m.files, m.files[0]],
      [{ ...m.files[0], path: "../escape" }],
    ]) {
      await writeFile(
        path.join(root, "windows-runtime-manifest.json"),
        JSON.stringify({ ...m, files }),
      );
      assert.throws(() => verifyRuntimeCandidate(root));
    }
  }));
