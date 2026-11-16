import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const modelSpec = JSON.parse(await readFile(
  new URL("../lib/offline/bundled-model-spec.json", import.meta.url), "utf8",
));

async function digest(file) {
  const sha = createHash("sha256");
  const md5 = createHash("md5");
  let bytes = 0;
  let magic = "";
  for await (const chunk of createReadStream(file)) {
    if (!bytes) magic = chunk.subarray(0, 4).toString("ascii");
    bytes += chunk.length;
    sha.update(chunk);
    md5.update(chunk);
  }
  return { bytes, sha256: sha.digest("hex"), md5: md5.digest("hex"), magic };
}

async function verifyModel(file, expected) {
  if ((await stat(file)).size !== expected.bytes) throw new Error("Model size does not match the pinned specification.");
  const result = await digest(file);
  if (result.magic !== "GGUF" || result.sha256 !== expected.sha256) {
    throw new Error("Model SHA-256/GGUF check failed; refusing to package it.");
  }
  return result;
}

async function verifyLicense(file, expected) {
  const text = await readFile(file);
  if (createHash("sha256").update(text).digest("hex") !== expected.licenseSha256) {
    throw new Error("Apache-2.0 license text does not match the pinned license.");
  }
}

export async function prepareAssets({ source, license, out, expected = modelSpec }) {
  const directory = path.join(out, "offline-model");
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `${expected.filename}.part`);
  const manifestPath = path.join(directory, "manifest.json");
  // A failed preparation must not leave a manifest claiming the stage is ready.
  await rm(manifestPath, { force: true });
  try {
    await verifyLicense(license, expected);
    await copyFile(source, temporary);
    const checked = await verifyModel(temporary, expected);
    await rename(temporary, path.join(directory, expected.filename));
    await copyFile(license, path.join(directory, "LICENSE.txt"));
    await writeFile(path.join(directory, "NOTICE.txt"), [
      "Qwen3-1.7B by Qwen / Alibaba Cloud; GGUF quantization distributed by Unsloth.",
      `License: ${expected.license}. See LICENSE.txt.`,
      `Source: https://huggingface.co/${expected.repository}/tree/${expected.revision}`,
      `Model SHA-256: ${expected.sha256}`,
      "This is the chat model only, not a speech runtime or voice model.",
      "",
    ].join("\n"));
    const manifest = { ...expected, format: 1, md5: checked.md5 };
    await writeFile(`${manifestPath}.part`, `${JSON.stringify(manifest, null, 2)}\n`);
    await rename(`${manifestPath}.part`, manifestPath);
    return manifest;
  } finally {
    await rm(temporary, { force: true });
    await rm(`${manifestPath}.part`, { force: true });
  }
}

export async function verifyAssets(out, expected = modelSpec) {
  const directory = path.join(out, "offline-model");
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  for (const [key, value] of Object.entries(expected)) {
    if (manifest[key] !== value) throw new Error(`Packaged manifest mismatch: ${key}`);
  }
  const result = await verifyModel(path.join(directory, expected.filename), expected);
  if (manifest.format !== 1 || manifest.md5 !== result.md5) throw new Error("Packaged manifest integrity mismatch.");
  await verifyLicense(path.join(directory, "LICENSE.txt"), expected);
  const notice = await readFile(path.join(directory, "NOTICE.txt"), "utf8");
  if (!notice.includes(expected.revision) || !notice.includes(expected.license)) {
    throw new Error("Packaged model attribution is missing.");
  }
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const option = (name) => {
      const index = args.indexOf(name);
      if (index < 0 || !args[index + 1] || args[index + 1].startsWith("--")) {
        throw new Error(`Missing ${name}. Use --source MODEL --license LICENSE --out ASSETS_DIR, or --verify ASSETS_DIR.`);
      }
      return path.resolve(args[index + 1]);
    };
    const result = args.includes("--verify")
      ? await verifyAssets(option("--verify"))
      : await prepareAssets({ source: option("--source"), license: option("--license"), out: option("--out") });
    console.info(`Verified packaged chat model: ${result.name}, ${result.bytes} bytes, SHA-256 ${result.sha256}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
