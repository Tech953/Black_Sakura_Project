import {
  cpSync,
  rmSync,
  mkdirSync,
  chmodSync,
  existsSync,
  readdirSync,
  realpathSync,
  statSync,
  copyFileSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  checkLlamaRuntime,
  checkLlamaRuntimeArchitecture,
} from "./llama-runtime-check.mjs";
import {
  LLAMA_RUNTIME_ASSETS,
  LLAMA_VERSION,
} from "./llama-runtime-metadata.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, ".."); // artifacts/desktop
const repoRoot = path.join(desktopDir, "..", ".."); // workspace root
const resources = path.join(desktopDir, "resources");
const bundleLlmSetting = process.env.DESKTOP_BUNDLE_LLM ?? "1";
const requireLlamaRuntime = process.env.DESKTOP_REQUIRE_LLAMA_RUNTIME === "1";

if (bundleLlmSetting !== "0" && bundleLlmSetting !== "1") {
  throw new Error(
    `Invalid DESKTOP_BUNDLE_LLM="${bundleLlmSetting}" (expected "0" or "1").`,
  );
}
const bundleLlm = bundleLlmSetting === "1";

function requireDir(dir, hint) {
  if (!existsSync(dir)) {
    throw new Error(`Missing ${dir}\n  -> ${hint}`);
  }
}

const apiDist = path.join(repoRoot, "artifacts", "api-server", "dist");
const webSrc = path.join(repoRoot, "artifacts", "engram", "dist", "public");
const drizzleSrc = path.join(repoRoot, "lib", "db", "drizzle");
const pgliteSrc = path.join(
  repoRoot,
  "artifacts",
  "api-server",
  "node_modules",
  "@electric-sql",
  "pglite",
);

requireDir(
  apiDist,
  "Build the API first: pnpm --filter @workspace/api-server run build",
);
requireDir(
  webSrc,
  "Build the web first: PORT=5000 BASE_PATH=/ pnpm --filter @workspace/engram run build",
);
requireDir(
  drizzleSrc,
  "Generate migrations first: pnpm --filter @workspace/db run generate",
);
requireDir(
  pgliteSrc,
  "Install deps first: pnpm install (expected @electric-sql/pglite under api-server)",
);

// Clean slate so stale assets never ship.
rmSync(resources, { recursive: true, force: true });
mkdirSync(resources, { recursive: true });

// 1. Server bundle — copy the runtime .mjs files only (skip .map sources).
const serverOut = path.join(resources, "server");
mkdirSync(serverOut, { recursive: true });
for (const file of readdirSync(apiDist)) {
  if (file.endsWith(".mjs")) {
    cpSync(path.join(apiDist, file), path.join(serverOut, file));
  }
}

// 2. PGlite — the only externalized runtime dependency of the server bundle.
//    Dereference the pnpm symlink so the package (incl. its wasm/data files)
//    ships as real files next to the bundle, resolvable as a bare import.
const pgliteOut = path.join(
  serverOut,
  "node_modules",
  "@electric-sql",
  "pglite",
);
mkdirSync(path.dirname(pgliteOut), { recursive: true });
cpSync(pgliteSrc, pgliteOut, { recursive: true, dereference: true });

// 3. Web (built dashboard served by the embedded API at WEB_DIST).
cpSync(webSrc, path.join(resources, "web"), { recursive: true });

// 4. Drizzle migrations (run by ensureDatabaseReady on first launch).
cpSync(drizzleSrc, path.join(resources, "drizzle"), { recursive: true });

// Target platform for EVERYTHING platform-specific we stage (ffmpeg/ffprobe
// and the llama.cpp binaries). Defaults to the host; overridable via
// LLAMA_TARGET (win32|linux|darwin) for cross-packaging — e.g. building the
// Windows portable zip from a Linux workspace. The name is historical; it now
// governs all target-specific resources.
const pkgTarget = process.env.LLAMA_TARGET || process.platform;
const llamaArchitecture = process.env.LLAMA_ARCH || process.arch;

// 5. ffmpeg + ffprobe — the TARGET-platform binaries the media worker needs for
//    the VIDEO modality (frame sampling + audio extraction). When packaging for
//    the host OS, ffmpeg-static's downloaded binary and ffprobe-static's
//    resolved path are used directly. When cross-packaging (pkgTarget != host):
//    - ffprobe: ffprobe-static ships binaries for all platforms inside the
//      package (bin/<platform>/<arch>/), so the target one is picked from there.
//    - ffmpeg: ffmpeg-static only downloads the host binary, so the target
//      binary must be pre-staged in the repo-root `.ffmpeg/` cache as
//      `ffmpeg-<target>-x64[.exe]` (download it from the ffmpeg-static GitHub
//      release matching the installed package's binary-release-tag). Missing
//      cross binaries FAIL the build — shipping a host-OS ffmpeg in a foreign
//      target's package would silently break media processing.
//    main.ts points the server child at the bundle via FFMPEG_PATH/FFPROBE_PATH.
//    On macOS these unsigned Mach-O binaries are code-signed during packaging via
//    the `mac.binaries` list in electron-builder.yml so notarized builds succeed.
const exe = pkgTarget === "win32" ? ".exe" : "";
let ffmpegSrc;
let ffprobeSrc;
if (pkgTarget === process.platform) {
  ffmpegSrc = require("ffmpeg-static");
  ffprobeSrc = require("ffprobe-static").path;
  requireDir(
    ffmpegSrc,
    "ffmpeg-static did not provide a binary; reinstall deps (its postinstall downloads it).",
  );
  requireDir(
    ffprobeSrc,
    "ffprobe-static did not provide a binary; reinstall deps.",
  );
} else {
  ffmpegSrc = path.join(repoRoot, ".ffmpeg", `ffmpeg-${pkgTarget}-x64${exe}`);
  requireDir(
    ffmpegSrc,
    `cross-packaging for ${pkgTarget}: target ffmpeg missing. Download the ` +
      `${pkgTarget}-x64 asset of ffmpeg-static's binary release (see ` +
      `"binary-release-tag" in node_modules/ffmpeg-static/package.json) to ${ffmpegSrc}`,
  );
  ffprobeSrc = path.join(
    path.dirname(require.resolve("ffprobe-static/package.json")),
    "bin",
    pkgTarget,
    "x64",
    `ffprobe${exe}`,
  );
  requireDir(
    ffprobeSrc,
    `cross-packaging for ${pkgTarget}: ffprobe-static has no bundled ${pkgTarget}/x64 binary.`,
  );
}

const binOut = path.join(resources, "bin");
mkdirSync(binOut, { recursive: true });
const ffmpegOut = path.join(binOut, `ffmpeg${exe}`);
const ffprobeOut = path.join(binOut, `ffprobe${exe}`);
cpSync(ffmpegSrc, ffmpegOut);
cpSync(ffprobeSrc, ffprobeOut);
chmodSync(ffmpegOut, 0o755);
chmodSync(ffprobeOut, 0o755);

// 6. Trusted llama.cpp runtime and optional default model. The fixed runtime is
//    needed for user-imported GGUFs even in slim builds; DESKTOP_BUNDLE_LLM=0
//    omits only the multi-GB default model. Release CI pins and verifies the
//    runtime archive before this staging step.
const llamaCache = path.join(repoRoot, ".llama");
const llamaTarget = pkgTarget;
const LLAMA_MODEL_FILE = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const LLAMA_MODEL_BYTES = 2_497_281_120;
const LLAMA_MODEL_SHA256 =
  "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597";
const modelSrc = path.join(llamaCache, LLAMA_MODEL_FILE);

function verifyBaselineModel(filePath) {
  let fd;
  try {
    fd = openSync(filePath, "r");
    const header = Buffer.alloc(16);
    const headerBytes = readSync(fd, header, 0, header.length, 0);
    if (
      headerBytes < 8 ||
      header.subarray(0, 4).toString("ascii") !== "GGUF" ||
      header.readUInt32LE(4) !== 3
    ) {
      throw new Error(
        `[desktop] baseline model is not a supported GGUF v3 file: ${filePath}`,
      );
    }

    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytes = 0;
    let read;
    do {
      read = readSync(fd, buffer, 0, buffer.length, null);
      if (read > 0) {
        hash.update(buffer.subarray(0, read));
        bytes += read;
      }
    } while (read > 0);

    const sha256 = hash.digest("hex");
    if (bytes !== LLAMA_MODEL_BYTES || sha256 !== LLAMA_MODEL_SHA256) {
      throw new Error(
        `[desktop] baseline model verification failed for ${filePath}: ` +
          `expected ${LLAMA_MODEL_BYTES} bytes with SHA-256 ${LLAMA_MODEL_SHA256}, ` +
          `received ${bytes} bytes with SHA-256 ${sha256}.`,
      );
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function stageLlama(includeDefaultModel) {
  const llamaOut = path.join(resources, "llama");
  const binOutDir = path.join(llamaOut, "bin");
  // Always create the dir so the electron-builder extraResources entry never
  // fails, even when no bundled model is staged.
  mkdirSync(llamaOut, { recursive: true });

  let binSrcDir = null;
  if (llamaTarget === "win32") {
    // Unzipped contents of the pinned llama.cpp win-cpu-x64 release.
    const winDir = path.join(
      llamaCache,
      `llama-${LLAMA_VERSION}-win-x64`,
    );
    if (existsSync(winDir)) binSrcDir = winDir;
  } else {
    // Linux/macOS release layout: the exact pinned version directory.
    const pinnedDir = path.join(
      llamaCache,
      `llama-${LLAMA_VERSION}`,
    );
    if (existsSync(pinnedDir)) binSrcDir = pinnedDir;
  }

  if (!binSrcDir) {
    const message =
      `[desktop] llama.cpp runtime cache is incomplete for target ${llamaTarget}; ` +
      "custom GGUF mode will be unavailable.";
    if (requireLlamaRuntime) throw new Error(message);
    console.warn(message);
    return false;
  }
  if (requireLlamaRuntime) {
    const markerPath = path.join(binSrcDir, ".engram-verified-runtime.json");
    let marker;
    try {
      marker = JSON.parse(readFileSync(markerPath, "utf8"));
    } catch {
      throw new Error(
        `[desktop] pinned llama.cpp verification marker missing at ${markerPath}.`,
      );
    }
    const expectedArchitecture = process.env.LLAMA_ARCH || process.arch;
    const expectedArchiveSha256 =
      LLAMA_RUNTIME_ASSETS[`${llamaTarget}-${expectedArchitecture}`]?.sha256;
    if (
      !expectedArchiveSha256 ||
      marker.version !== LLAMA_VERSION ||
      marker.platform !== llamaTarget ||
      marker.architecture !== expectedArchitecture ||
      marker.archiveSha256 !== expectedArchiveSha256
    ) {
      throw new Error(
        `[desktop] llama.cpp verification marker does not match ${llamaTarget}-${expectedArchitecture} ${LLAMA_VERSION}.`,
      );
    }
  }

  mkdirSync(binOutDir, { recursive: true });
  // Copy ONLY the server executable and its shared libraries — the release
  // archives also contain a dozen CLI tools (llama.exe, llama-tts, …) that
  // would bloat the installer and (on macOS) widen the signing/notarization
  // surface for no benefit.
  const keep = (name) =>
    /^llama-server(\.exe)?$/.test(name) ||
    /\.(dll|dylib|metal)$/.test(name) ||
    /\.so(\.\d+)*$/.test(name);
  for (const entry of readdirSync(binSrcDir)) {
    if (!keep(entry)) continue;
    // Resolve symlinks by hand: llama.cpp releases ship soname symlink chains
    // (libggml-base.so -> .so.0 -> .so.0.18.0) that trip cpSync's dereference.
    const src = path.join(binSrcDir, entry);
    let real;
    try {
      real = realpathSync(src);
      if (!statSync(real).isFile()) continue;
    } catch {
      continue; // dangling symlink
    }
    copyFileSync(real, path.join(binOutDir, entry));
  }
  const stagedServer = path.join(
    binOutDir,
    llamaTarget === "win32" ? "llama-server.exe" : "llama-server",
  );
  if (!existsSync(stagedServer)) {
    const message = `[desktop] staged llama.cpp runtime has no llama-server for ${llamaTarget}.`;
    if (requireLlamaRuntime) throw new Error(message);
    console.warn(message);
    return false;
  }
  if (requireLlamaRuntime) {
    const architectureResult = checkLlamaRuntimeArchitecture({
      executablePath: stagedServer,
      platform: llamaTarget,
      architecture: llamaArchitecture,
    });
    if (!architectureResult.ok) {
      throw new Error(architectureResult.message);
    }
    console.log(
      `[desktop] llama.cpp staged architecture verified (` +
        `${architectureResult.architectures.join(", ")}; expected ` +
        `${llamaTarget}-${llamaArchitecture})`,
    );

    if (llamaTarget === process.platform && llamaArchitecture === process.arch) {
      const runtime = checkLlamaRuntime({
        executablePath: stagedServer,
        platform: llamaTarget,
        architecture: llamaArchitecture,
      });
      if (!runtime.ok) {
        throw new Error(runtime.message);
      }
      console.log(
        `[desktop] llama.cpp native dependency preflight passed (${runtime.code})`,
      );
    } else {
      console.warn(
        `[desktop] deferred llama.cpp dependency preflight for cross-target ` +
          `${llamaTarget}-${llamaArchitecture}; run it on a matching runner.`,
      );
    }
  }
  if (includeDefaultModel && !existsSync(modelSrc)) {
    throw new Error(
      `[desktop] baseline GGUF missing at ${modelSrc}; ` +
        `stage ${LLAMA_MODEL_FILE} before building a full desktop package.`,
    );
  }
  if (includeDefaultModel) {
    verifyBaselineModel(modelSrc);
    cpSync(modelSrc, path.join(llamaOut, "model.gguf"));
  }
  if (llamaTarget !== "win32") {
    const serverBin = path.join(binOutDir, "llama-server");
    if (existsSync(serverBin)) chmodSync(serverBin, 0o755);
  }
  console.log(
    `[desktop] llama.cpp runtime staged (${llamaTarget}, default model: ${includeDefaultModel ? "verified" : "omitted"}) -> ${llamaOut}`,
  );
  return true;
}

stageLlama(bundleLlm);
if (!bundleLlm) {
  console.log(
    "[desktop] default GGUF intentionally omitted (DESKTOP_BUNDLE_LLM=0); " +
      "the packaged llama.cpp runtime remains available for managed custom GGUFs.",
  );
}

console.log("[desktop] resources prepared ->", resources);
