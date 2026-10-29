import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectAsset, prepare, safeDestination, stageAsset, validateSourceInventory } from "./prepare-full-rezz-assets.mjs";
import { BUNDLE_NOTICE, MODEL_ASSETS, NOTICES, SOURCE } from "./full-rezz-asset-spec.mjs";

const digest = (text) => createHash("sha256").update(text).digest("hex");
async function temporary(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "full-rezz-stage-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("stage paths cannot escape their root", () => {
  const root = path.join(os.tmpdir(), "full-rezz-stage");
  for (const name of ["../seed.json", "/seed.json", "models\\file", "./file", "models//file", ""]) {
    assert.throws(() => safeDestination(root, name));
  }
  assert.equal(safeDestination(root, "models/tts.bin"), path.join(root, "models", "tts.bin"));
});

test("assets require the pinned bytes and SHA-256 or Git blob identity", async () => temporary(async (root) => {
  const target = path.join(root, "asset");
  await writeFile(target, "data");
  const spec = { path: "asset", bytes: 4, sha256: digest("data") };
  assert.equal((await inspectAsset(target, spec)).sha256, spec.sha256);
  await assert.rejects(inspectAsset(target, { ...spec, bytes: 5 }), /size/);
  await assert.rejects(inspectAsset(target, { ...spec, sha256: digest("evil") }), /hash/);
  await assert.rejects(inspectAsset(target, { path: "asset" }), /hash/);
  const gitBlob = createHash("sha1").update("blob 4\0data").digest("hex");
  assert.equal((await inspectAsset(target, { path: "asset", bytes: 4, gitBlob })).bytes, 4);
}));

test("failed download never activates an asset or retains partial bytes", async () => temporary(async (root) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("evil");
  try {
    await assert.rejects(stageAsset(root, { path: "model", url: "https://example.invalid", bytes: 4, sha256: digest("data") }, false), /hash/);
    await assert.rejects(readFile(path.join(root, "model")), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(root, "model.partial")), { code: "ENOENT" });
  } finally { globalThis.fetch = original; }
}));

test("verified stages reuse bytes without network and do not overwrite corrupt existing files", async () => temporary(async (root) => {
  const spec = { path: "model", url: "https://example.invalid", bytes: 4, sha256: digest("data") };
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("data");
  try {
    await stageAsset(root, spec, false);
    globalThis.fetch = async () => { throw new Error("Network is disabled"); };
    await stageAsset(root, spec, true);
    await writeFile(path.join(root, "model"), "evil");
    await assert.rejects(stageAsset(root, spec, false), /hash/);
    assert.equal(await readFile(path.join(root, "model"), "utf8"), "evil");
  } finally { globalThis.fetch = original; }
}));

test("a locally forged source inventory cannot bless modified source", () => {
  assert.throws(() => validateSourceInventory([{ path: "voice_studio/worker.py", bytes: 0, gitBlob: "0".repeat(40) }]), /inventory mismatch/);
});

test("failed verification removes an old successful-looking stage marker without networking", async () => temporary(async (root) => {
  await writeFile(path.join(root, "asset-stage.json"), '{"assetsVerified":true}');
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Network is disabled"); };
  try {
    await assert.rejects(prepare(root, true), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(root, "asset-stage.json")), { code: "ENOENT" });
  } finally { globalThis.fetch = original; }
}));

test("model sources are pinned and component-specific notices accompany noncommercial weights", () => {
  assert.match(SOURCE.revision, /^[a-f0-9]{40}$/);
  for (const asset of MODEL_ASSETS) {
    assert.match(asset.url, /\/resolve\/[a-f0-9]{40}\//);
    assert.ok(asset.bytes > 0);
    assert.ok(asset.sha256 || asset.gitBlob);
  }
  assert.equal(MODEL_ASSETS.find((asset) => asset.path.endsWith(".safetensors")).license, "CC-BY-NC-4.0");
  assert.ok(NOTICES.some((asset) => asset.path === "CC-BY-NC-4.0.txt"));
  assert.match(BUNDLE_NOTICE, /INCOMPLETE runtime stage/);
  assert.match(BUNDLE_NOTICE, /Studio Unit is not Rebecca/);
  assert.match(BUNDLE_NOTICE, /NOT relicensed as CC-BY-NC-4.0/);
});
