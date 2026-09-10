import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LINUX_PACKAGE_HINTS = {
  "libstdc++.so.6": "libstdc++6",
  "libssl.so.3": "libssl3",
  "libcrypto.so.3": "libssl3",
  "libgomp.so.1": "libgomp1",
};

// These are the stable runtime pieces shipped by the pinned Windows CPU
// archive. The archive is self-contained; unlike Linux, Windows users should
// not need to install a system package for llama.cpp.
const WINDOWS_RUNTIME_FILES = [
  "ggml.dll",
  "ggml-base.dll",
  "ggml-cpu-x64.dll",
  "llama.dll",
  "llama-common.dll",
  "llama-server-impl.dll",
  "libomp140.x86_64.dll",
];

function unique(values) {
  return [...new Set(values)];
}

function linuxDependencyCheck(executablePath, env) {
  const result = spawnSync("ldd", [executablePath], {
    encoding: "utf8",
    env,
  });
  if (result.error) {
    return {
      ok: false,
      code: "ldd-unavailable",
      message:
        `Linux llama.cpp runtime preflight could not run ldd: ${result.error.message}. ` +
        "Run the packaged smoke test on a Linux host with ldd installed.",
    };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const missing = unique(
    [...output.matchAll(/^\s*([^\s]+)\s+=>\s+not found\s*$/gm)].map(
      ([, name]) => name,
    ),
  );
  if (result.status !== 0 && missing.length === 0) {
    return {
      ok: false,
      code: "ldd-failed",
      message:
        `Linux llama.cpp runtime preflight could not inspect ${executablePath}: ` +
        `${output.trim() || `ldd exited with status ${result.status}`}`,
    };
  }
  if (missing.length > 0) {
    const packageNames = unique(
      missing.map((name) => LINUX_PACKAGE_HINTS[name]).filter(Boolean),
    );
    const packageHint = packageNames.length
      ? ` Install the equivalent runtime packages (Debian/Ubuntu: ${packageNames.join(", ")}).`
      : "";
    return {
      ok: false,
      code: "missing-linux-dependencies",
      missing,
      message:
        `Linux llama.cpp runtime preflight failed for ${executablePath}: ` +
        `unresolved shared libraries: ${missing.join(", ")}.${packageHint} ` +
        "AppImage users must provide equivalent libraries; the .deb declares these " +
        "dependencies. For local NixOS smoke runs, set LD_LIBRARY_PATH to compatible " +
        "GCC/OpenSSL/OpenMP runtime directories before launching the smoke test.",
    };
  }

  return { ok: true, code: "linux-dependencies-resolved" };
}

function windowsDependencyCheck(executablePath) {
  const binDir = path.dirname(executablePath);
  const missing = WINDOWS_RUNTIME_FILES.filter(
    (name) => !existsSync(path.join(binDir, name)),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-windows-dlls",
      missing,
      message:
        `Windows llama.cpp runtime preflight failed for ${executablePath}: ` +
        `missing adjacent runtime DLLs: ${missing.join(", ")}. ` +
        "Re-stage the complete pinned win-cpu-x64 llama.cpp archive.",
    };
  }

  return {
    ok: true,
    code: "windows-dlls-present",
    dllCount: readdirSync(binDir).filter((name) => name.endsWith(".dll")).length,
  };
}

export function checkLlamaRuntime({
  executablePath,
  platform = process.platform,
  env = process.env,
}) {
  if (!existsSync(executablePath)) {
    return {
      ok: false,
      code: "missing-server",
      message: `Packaged llama.cpp server is missing: ${executablePath}`,
    };
  }
  if (platform === "linux") return linuxDependencyCheck(executablePath, env);
  if (platform === "win32") return windowsDependencyCheck(executablePath);
  return {
    ok: true,
    code: "platform-not-inspected",
    message: `llama.cpp dependency inspection is not configured for ${platform}.`,
  };
}