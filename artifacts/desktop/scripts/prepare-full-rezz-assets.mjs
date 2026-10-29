import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { fileURLToPath } from "node:url";
import { SOURCE, MODEL_ASSETS, NOTICES, BUNDLE_NOTICE } from "./full-rezz-asset-spec.mjs";

export function safeDestination(root, relative) {
  if (path.isAbsolute(relative) || relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe asset path: ${relative}`);
  }
  const target = path.resolve(root, relative);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error("Asset escaped stage.");
  return target;
}

export async function inspectAsset(file, spec) {
  const info = await stat(file);
  if (!info.isFile() || (spec.bytes !== undefined && info.size !== spec.bytes)) {
    throw new Error(`Incorrect asset size: ${spec.path}`);
  }
  const sha = createHash("sha256");
  const git = createHash("sha1").update(`blob ${info.size}\0`);
  for await (const chunk of createReadStream(file)) { sha.update(chunk); git.update(chunk); }
  const sha256 = sha.digest("hex");
  const gitBlob = git.digest("hex");
  if ((!spec.sha256 && !spec.gitBlob) ||
      (spec.sha256 && sha256 !== spec.sha256) ||
      (spec.gitBlob && gitBlob !== spec.gitBlob)) {
    throw new Error(`Incorrect asset hash: ${spec.path}`);
  }
  return { path: spec.path, bytes: info.size, sha256, url: spec.url, license: spec.license };
}

export async function stageAsset(root, spec, verifyOnly) {
  const target = safeDestination(root, spec.path);
  // A bad existing asset fails closed. Never silently bless or overwrite it.
  try { await stat(target); return await inspectAsset(target, spec); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (verifyOnly) throw new Error(`Missing staged asset: ${spec.path}`);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.partial`;
  try {
    console.log(`Staging ${spec.path}`);
    const response = await fetch(spec.url, { signal: AbortSignal.timeout(600_000) });
    if (!response.ok || !response.body) throw new Error(`Asset download failed (${response.status}): ${spec.path}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: "w" }));
    const inventory = await inspectAsset(temporary, spec);
    await rename(temporary, target);
    return inventory;
  } finally { await rm(temporary, { force: true }); }
}

export function validateSourceInventory(entries) {
  const inventory = entries.map(({ path, bytes, gitBlob }) => ({ path, bytes, gitBlob }))
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const digest = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
  if (digest !== SOURCE.inventorySha256) throw new Error("Pinned FULL_REZZ source inventory mismatch.");
  return inventory;
}

async function sourceSpecs(root, verifyOnly) {
  const treeFile = path.join(root, "source-tree.json");
  let files;
  if (verifyOnly) {
    files = validateSourceInventory(JSON.parse(await readFile(treeFile, "utf8")));
  } else {
    const response = await fetch(`https://api.github.com/repos/${SOURCE.repository}/git/trees/${SOURCE.revision}?recursive=1`);
    if (!response.ok) throw new Error(`Source inventory unavailable (${response.status}).`);
    const tree = await response.json();
    if (tree.truncated || tree.sha !== SOURCE.revision) throw new Error("Unexpected source revision or truncated inventory.");
    files = validateSourceInventory(tree.tree
      .filter((entry) => entry.type === "blob" && entry.path.startsWith(SOURCE.prefix))
      .map((entry) => ({
        path: entry.path.slice(SOURCE.prefix.length), bytes: entry.size, gitBlob: entry.sha,
      })));
    await writeFile(treeFile, JSON.stringify(files, null, 2) + "\n");
  }
  return files.map((entry) => ({
    ...entry,
    url: `https://raw.githubusercontent.com/${SOURCE.repository}/${SOURCE.revision}/${SOURCE.prefix}${entry.path}`,
    license: "Upstream LICENSE / component-specific THIRD_PARTY_NOTICES.md",
  }));
}

export async function prepare(root, verifyOnly = false) {
  root = path.resolve(root);
  await mkdir(root, { recursive: true });
  const readinessFile = path.join(root, "asset-stage.json");
  // Never retain a successful-looking inventory after an interrupted/failed pass.
  await rm(readinessFile, { force: true });
  const specs = await sourceSpecs(root, verifyOnly);
  const source = [];
  for (const spec of specs) source.push(await stageAsset(root, spec, verifyOnly));
  const models = [];
  for (const spec of MODEL_ASSETS) models.push(await stageAsset(path.join(root, "models"), spec, verifyOnly));
  const notices = [];
  for (const spec of NOTICES) notices.push(await stageAsset(path.join(root, "licenses"), spec, verifyOnly));
  const modelManifest = JSON.stringify({ assets: models }, null, 2) + "\n";
  if (verifyOnly) {
    if (await readFile(path.join(root, "models/manifest.json"), "utf8") !== modelManifest ||
        await readFile(path.join(root, "BUNDLE_NOTICE.md"), "utf8") !== BUNDLE_NOTICE) {
      throw new Error("Generated model manifest or distribution notice was changed.");
    }
  } else {
    await writeFile(path.join(root, "models/manifest.json"), modelManifest);
    await writeFile(path.join(root, "BUNDLE_NOTICE.md"), BUNDLE_NOTICE);
  }
  const result = {
    schemaVersion: 1, distribution: "personal-noncommercial",
    source: SOURCE, assetsVerified: true, runtimeReady: false,
    missing: [
      "Platform Python and complete inference/render dependency runtime",
      "Verified fonts, espeak-ng and companion llama-cpp vendor bundles/manifests/notices",
      "Android-native FULL_REZZ speech implementation",
      "Actual Windows and Android fresh-install/network-disabled acceptance",
    ],
    sourceFiles: source, modelFiles: models, notices,
  };
  await writeFile(readinessFile, JSON.stringify(result, null, 2) + "\n");
  console.log(`Verified ${source.length} source files, ${models.length} model assets and ${notices.length} notices. Runtime ready: false.`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const verifyOnly = args[0] === "--verify";
  const root = args[verifyOnly ? 1 : 0];
  if (!root || args.length !== (verifyOnly ? 2 : 1)) {
    console.error("Usage: prepare-full-rezz-assets.mjs [--verify] GENERATED_STAGE_DIRECTORY");
    process.exitCode = 1;
  } else {
    try { await prepare(root, verifyOnly); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
