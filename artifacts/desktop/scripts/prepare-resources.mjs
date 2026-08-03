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
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.join(here, ".."); // artifacts/desktop
const repoRoot = path.join(desktopDir, "..", ".."); // workspace root
const resources = path.join(desktopDir, "resources");

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

// 6. Bundled local LLM (llama.cpp server + GGUF model) so chat/analysis/
//    simulation run fully offline with zero setup. Staged from the repo-root
//    `.llama/` cache (gitignored). Targets pkgTarget (see above).
//    If the cache is missing, the build still succeeds WITHOUT a bundled
//    model — the app then falls back to the external-local-server mode.
const llamaCache = path.join(repoRoot, ".llama");
const llamaTarget = pkgTarget;
const LLAMA_MODEL_FILE = "Qwen3-4B-Instruct-2507-Q4_K_M.gguf";
const modelSrc = path.join(llamaCache, LLAMA_MODEL_FILE);

function stageLlama() {
  const llamaOut = path.join(resources, "llama");
  const binOutDir = path.join(llamaOut, "bin");
  // Always create the dir so the electron-builder extraResources entry never
  // fails, even when no bundled model is staged.
  mkdirSync(llamaOut, { recursive: true });

  let binSrcDir = null;
  if (llamaTarget === "win32") {
    // Unzipped contents of the llama.cpp win-cpu-x64 release.
    const winDir = path.join(llamaCache, "win-x64");
    if (existsSync(winDir)) binSrcDir = winDir;
  } else {
    // Linux/macOS release layout: a single dir with llama-server + shared libs.
    const dirs = existsSync(llamaCache)
      ? readdirSync(llamaCache).filter((d) => /^llama-b\d+$/.test(d))
      : [];
    if (dirs.length > 0) binSrcDir = path.join(llamaCache, dirs[0]);
  }

  if (!binSrcDir || !existsSync(modelSrc)) {
    console.warn(
      `[desktop] no bundled LLM staged (cache ${llamaCache} incomplete for target ${llamaTarget}); ` +
        "the app will fall back to external local-server mode.",
    );
    return;
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
  cpSync(modelSrc, path.join(llamaOut, "model.gguf"));
  if (llamaTarget !== "win32") {
    const serverBin = path.join(binOutDir, "llama-server");
    if (existsSync(serverBin)) chmodSync(serverBin, 0o755);
  }
  console.log(
    `[desktop] bundled LLM staged (${llamaTarget}) -> ${llamaOut}`,
  );
}

stageLlama();

console.log("[desktop] resources prepared ->", resources);
