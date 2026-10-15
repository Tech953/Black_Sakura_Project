import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  LLAMA_RUNTIME_ASSETS,
  LLAMA_VERSION,
} from "./llama-runtime-metadata.mjs";

const RELEASE_BASE =
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}`;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const defaultCache = path.join(repoRoot, ".llama");

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function prepareLlamaRuntime({
  platform = process.env.LLAMA_TARGET || process.platform,
  architecture = process.env.LLAMA_ARCH || process.arch,
  cache = defaultCache,
  assetCatalog = LLAMA_RUNTIME_ASSETS,
  releaseBase = RELEASE_BASE,
  fetchImpl = globalThis.fetch,
  spawnSyncImpl = spawnSync,
  renameFile = rename,
} = {}) {
  const asset = assetCatalog[`${platform}-${architecture}`];
  if (!asset) {
    throw new Error(
      `No pinned llama.cpp CPU runtime for ${platform}-${architecture}.`,
    );
  }

  const destination =
    platform === "win32"
      ? path.join(cache, `llama-${LLAMA_VERSION}-win-x64`)
      : path.join(cache, `llama-${LLAMA_VERSION}`);
  const executable = path.join(
    destination,
    platform === "win32" ? "llama-server.exe" : "llama-server",
  );

  mkdirSync(cache, { recursive: true });
  const archive = path.join(cache, asset.name);
  const temporary = `${archive}.${process.pid}.partial`;

  if (!existsSync(archive) || (await sha256(archive)) !== asset.sha256) {
    rmSync(archive, { force: true });
    rmSync(temporary, { force: true });
    console.log(`[desktop] downloading pinned llama.cpp runtime ${asset.name}`);

    try {
      const response = await fetchImpl(`${releaseBase}/${asset.name}`, {
        redirect: "follow",
      });
      if (!response.ok || !response.body) {
        throw new Error(
          `Could not download llama.cpp runtime (${response.status} ${response.statusText}).`,
        );
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      const actual = await sha256(temporary);
      if (actual !== asset.sha256) {
        throw new Error(
          `llama.cpp runtime checksum mismatch: expected ${asset.sha256}, got ${actual}.`,
        );
      }
      await renameFile(temporary, archive);
    } catch (error) {
      rmSync(temporary, { force: true });
      throw error;
    }
  }

  rmSync(destination, { recursive: true, force: true });
  mkdirSync(platform === "win32" ? destination : cache, { recursive: true });
  const extractor = platform === "win32" ? "unzip" : "tar";
  const extractArgs =
    platform === "win32"
      ? ["-q", archive, "-d", destination]
      : ["-xzf", archive, "-C", cache];
  const extracted = spawnSyncImpl(extractor, extractArgs, {
    stdio: "inherit",
    shell: false,
  });
  if (extracted.status !== 0 || !existsSync(executable)) {
    throw new Error(`Failed to extract llama.cpp runtime from ${archive}.`);
  }

  writeFileSync(
    path.join(destination, ".engram-verified-runtime.json"),
    `${JSON.stringify(
      {
        version: LLAMA_VERSION,
        platform,
        architecture,
        archiveSha256: asset.sha256,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  console.log(`[desktop] pinned llama.cpp runtime ready: ${executable}`);
  return { archive, executable };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await prepareLlamaRuntime();
}
