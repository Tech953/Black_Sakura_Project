import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LLAMA_VERSION = "b10242";
const RELEASE_BASE =
  `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_VERSION}`;

const assets = {
  "linux-x64": {
    name: `llama-${LLAMA_VERSION}-bin-ubuntu-x64.tar.gz`,
    sha256: "fb13c9fa97a605c6bba16a99b2f54eff6874d58bdbe5b94ece6e358eaa270088",
  },
  "linux-arm64": {
    name: `llama-${LLAMA_VERSION}-bin-ubuntu-arm64.tar.gz`,
    sha256: "c79ae4262304cdab2698201b1bba01648fcff8f8aada237b64797bc97ebe452d",
  },
  "darwin-x64": {
    name: `llama-${LLAMA_VERSION}-bin-macos-x64.tar.gz`,
    sha256: "d7ccf0251ff9087ee4f4c0ea6c8c7f4f3575aa187b2c2e755d2d4c5d234490ba",
  },
  "darwin-arm64": {
    name: `llama-${LLAMA_VERSION}-bin-macos-arm64.tar.gz`,
    sha256: "fd93f5c97086b434d17855eaaf95ba56758ade7a4af3a4ad74714bb70784c8b9",
  },
  "win32-x64": {
    name: `llama-${LLAMA_VERSION}-bin-win-cpu-x64.zip`,
    sha256: "a9b8966b2ed82d33a87cafb4149a1b40de48a701a0ec431f2d8f5b994827a758",
  },
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, "..", "..", "..");
const cache = path.join(repoRoot, ".llama");
const platform = process.env.LLAMA_TARGET || process.platform;
const architecture = process.env.LLAMA_ARCH || process.arch;
const asset = assets[`${platform}-${architecture}`];

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

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

if (!existsSync(archive) || (await sha256(archive)) !== asset.sha256) {
  rmSync(archive, { force: true });
  rmSync(temporary, { force: true });
  console.log(`[desktop] downloading pinned llama.cpp runtime ${asset.name}`);
  const response = await fetch(`${RELEASE_BASE}/${asset.name}`, {
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
    rmSync(temporary, { force: true });
    throw new Error(
      `llama.cpp runtime checksum mismatch: expected ${asset.sha256}, got ${actual}.`,
    );
  }
  await import("node:fs/promises").then(({ rename }) =>
    rename(temporary, archive),
  );
}

rmSync(destination, { recursive: true, force: true });
mkdirSync(platform === "win32" ? destination : cache, { recursive: true });
const extractor = platform === "win32" ? "unzip" : "tar";
const extractArgs =
  platform === "win32"
    ? ["-q", archive, "-d", destination]
    : ["-xzf", archive, "-C", cache];
const extracted = spawnSync(extractor, extractArgs, {
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