import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { modelSpec, prepareAssets, verifyAssets } from "./prepare-bundled-model.mjs";

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "engram-model-stage-"));
  try {
    const model = Buffer.from("GGUFtest fixture, not a model");
    const licenseText = "Apache License test fixture";
    const source = path.join(root, "input.gguf");
    const license = path.join(root, "LICENSE.txt");
    await writeFile(source, model);
    await writeFile(license, licenseText);
    const options = {
      source, license, out: path.join(root, "assets"),
      expected: {
        ...modelSpec, bytes: model.length,
        sha256: createHash("sha256").update(model).digest("hex"),
        licenseSha256: createHash("sha256").update(licenseText).digest("hex"),
      },
    };
    await run(options);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("stages a verified model, license and attribution then verifies the whole stage", () => fixture(async (options) => {
  const manifest = await prepareAssets(options);
  assert.equal(manifest.format, 1);
  assert.match(manifest.md5, /^[a-f0-9]{32}$/);
  assert.deepEqual(await verifyAssets(options.out, options.expected), manifest);
  const notice = await readFile(path.join(options.out, "offline-model/NOTICE.txt"), "utf8");
  assert.ok(notice.includes("chat model only"));
}));

test("rejects wrong-size models without leaving a ready manifest", () => fixture(async (options) => {
  await writeFile(options.source, "wrong");
  await assert.rejects(prepareAssets(options), /size/);
  await assert.rejects(readFile(path.join(options.out, "offline-model/manifest.json")), /ENOENT/);
}));

test("rejects same-size tampering at staging and at the Gradle preflight", () => fixture(async (options) => {
  await prepareAssets(options);
  const file = path.join(options.out, "offline-model", options.expected.filename);
  const bytes = await readFile(file);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(file, bytes);
  await assert.rejects(verifyAssets(options.out, options.expected), /SHA-256/);
  await writeFile(options.source, bytes);
  await assert.rejects(prepareAssets(options), /SHA-256/);
}));

test("rejects unreviewed license text", () => fixture(async (options) => {
  await writeFile(options.license, "not the Apache license");
  await assert.rejects(prepareAssets(options), /license text/);
}));

test("rejects missing attribution and a misleading manifest", () => fixture(async (options) => {
  await prepareAssets(options);
  await writeFile(path.join(options.out, "offline-model/NOTICE.txt"), "");
  await assert.rejects(verifyAssets(options.out, options.expected), /attribution/);
  const manifest = await prepareAssets(options);
  manifest.sha256 = "tampered";
  await writeFile(path.join(options.out, "offline-model/manifest.json"), JSON.stringify(manifest));
  await assert.rejects(verifyAssets(options.out, options.expected), /manifest mismatch/);
}));

test("the Expo prebuild plugin preserves the packaging hook without duplicating it", async () => {
  const app = JSON.parse(await readFile(new URL("../app.json", import.meta.url), "utf8"));
  assert.ok(app.expo.plugins.includes("./plugins/withBundledChatModel"));
  const { addHook } = createRequire(import.meta.url)("../plugins/withBundledChatModel.js");
  const hook = 'apply from: new File(rootProject.projectDir.parentFile, "scripts/bundled-chat-model.gradle")';
  const gradle = addHook("apply plugin: 'com.android.application'\n");
  assert.ok(gradle.includes(hook));
  assert.equal(addHook(gradle), gradle);
});
