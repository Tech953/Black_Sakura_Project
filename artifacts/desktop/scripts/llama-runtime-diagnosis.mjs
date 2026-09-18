const LINUX_RUNTIME_REPAIR =
  "Install the equivalent runtime packages for the host distribution, or set LD_LIBRARY_PATH to compatible runtime directories before launching the smoke test.";

export const LLAMA_RUNTIME_FAILURE_CODES = Object.freeze([
  "missing-server",
  "unsupported-architecture",
  "missing-linux-dependencies",
  "ldd-unavailable",
  "ldd-failed",
  "missing-macos-dylibs",
  "otool-unavailable",
  "otool-failed",
  "missing-windows-dlls",
  "runtime-architecture-mismatch",
  "runtime-architecture-unreadable",
  "runtime-not-executable",
  "runtime-execution-failed",
]);

export function llamaRuntimeRepairAction(code, reason) {
  if (code === "missing-linux-dependencies") return "install-linux-runtime";
  if (code === "missing-windows-dlls" || code === "missing-macos-dylibs") {
    return "restage-complete-runtime";
  }
  if (code === "runtime-not-executable" && reason === "permission-denied") {
    return "restore-execute-permission";
  }
  if (code === "runtime-not-executable" && reason === "exec-format-error") {
    return "rebuild-target-runtime";
  }
  if (code === "unsupported-architecture") return "build-target-runtime";
  if (code === "runtime-architecture-mismatch") return "rebuild-target-runtime";
  if (code === "runtime-architecture-unreadable") return "restage-runtime";
  if (code === "ldd-unavailable" || code === "otool-unavailable") {
    return "run-on-supported-host";
  }
  return "restage-runtime";
}

export function llamaRuntimeFailureMessage({
  code,
  executablePath,
  platform,
  architecture,
  missingLibraries = [],
  packageNames = [],
  reason,
  details,
}) {
  const target = executablePath ? ` ${executablePath}` : "";
  const missing = missingLibraries.join(", ");
  const packages = packageNames.length
    ? ` Install the equivalent runtime packages (Debian/Ubuntu: ${packageNames.join(", ")}).`
    : "";

  if (code === "missing-server") {
    return `Packaged llama.cpp server is missing: ${executablePath}`;
  }
  if (code === "unsupported-architecture") {
    return `No pinned llama.cpp runtime dependency contract exists for ${platform}-${architecture}.`;
  }
  if (code === "missing-linux-dependencies") {
    return (
      `Linux llama.cpp runtime preflight failed${target}: ` +
      `unresolved shared libraries: ${missing}.${packages} ` +
      "AppImage users must provide equivalent libraries; the .deb declares these " +
      "dependencies. " +
      LINUX_RUNTIME_REPAIR
    );
  }
  if (code === "ldd-unavailable") {
    return (
      `Linux llama.cpp runtime preflight could not run ldd: ${details}. ` +
      "Run the packaged smoke test on a Linux host with ldd installed."
    );
  }
  if (code === "ldd-failed") {
    return (
      `Linux llama.cpp runtime preflight could not inspect${target}: ` +
      `${details || "ldd failed without diagnostic output"}`
    );
  }
  if (code === "missing-macos-dylibs") {
    return (
      `macOS ${architecture} llama.cpp runtime preflight failed${target}: ` +
      `missing adjacent runtime dylibs: ${missing}. ` +
      "Re-stage the complete pinned macOS llama.cpp archive."
    );
  }
  if (code === "otool-unavailable") {
    return (
      `macOS llama.cpp runtime preflight could not run otool: ${details}. ` +
      "Run the packaged smoke test on a macOS host with Xcode command-line tools installed."
    );
  }
  if (code === "otool-failed") {
    return (
      `macOS llama.cpp runtime preflight could not inspect${target}: ` +
      `${details || "otool failed without diagnostic output"}`
    );
  }
  if (code === "missing-windows-dlls") {
    return (
      `Windows llama.cpp runtime preflight failed${target}: ` +
      `missing adjacent runtime DLLs: ${missing}. ` +
      "Re-stage the complete pinned win-cpu-x64 llama.cpp archive."
    );
  }
  if (code === "runtime-architecture-mismatch") {
    return (
      `Packaged llama.cpp server architecture mismatch${target}: ` +
      `detected ${details || "an incompatible architecture"}, expected ` +
      `${platform}-${architecture}. Rebuild or re-stage the llama.cpp binary ` +
      "for the requested target and rerun the packaged smoke test."
    );
  }
  if (code === "runtime-architecture-unreadable") {
    return (
      `Packaged llama.cpp server architecture could not be verified${target}: ` +
      `${details || "unrecognized executable format"}. Re-stage the pinned ` +
      "runtime and rerun the packaged smoke test."
    );
  }
  if (code === "runtime-not-executable" && reason === "permission-denied") {
    return (
      `Packaged llama.cpp server exists but cannot execute due to permission ` +
      `denied${target}. Re-stage the binary with execute permission ` +
      "(chmod +x) and rerun the packaged smoke test."
    );
  }
  if (code === "runtime-not-executable" && reason === "exec-format-error") {
    return (
      `Packaged llama.cpp server exists but has an execution-format error${target}. ` +
      `Rebuild or re-stage the llama.cpp binary for ${platform}-${architecture}, ` +
      "then rerun the packaged smoke test."
    );
  }
  return (
    `Packaged llama.cpp server exists but could not be executed${target}: ` +
    `${details || "unknown execution failure"}. Re-stage the runtime and rerun the packaged smoke test.`
  );
}

function missingLibrariesFromText(text, platform) {
  if (platform === "linux") {
    return [
      ...text.matchAll(
        /(?:error while loading shared libraries:\s*)?([A-Za-z0-9._+-]+\.so(?:\.\d+)?)\b/gi,
      ),
    ].map((match) => match[1]);
  }
  if (platform === "win32") {
    return [...text.matchAll(/\b([A-Za-z0-9._-]+\.dll)\b/gi)].map(
      (match) => match[1],
    );
  }
  return [];
}

export function classifyLlamaRuntimeError({
  errorCode = "",
  message = "",
  stderr = "",
  platform = process.platform,
}) {
  const normalizedCode = String(errorCode).toUpperCase();
  const text = `${message}\n${stderr}`;
  const missingLibraries = [
    ...new Set(missingLibrariesFromText(text, platform)),
  ];
  let code = "runtime-execution-failed";
  let reason;
  if (normalizedCode === "EACCES" || normalizedCode === "EPERM") {
    code = "runtime-not-executable";
    reason = "permission-denied";
  } else if (normalizedCode === "ENOEXEC") {
    code = "runtime-not-executable";
    reason = "exec-format-error";
  } else if (missingLibraries.length > 0 && platform === "linux") {
    code = "missing-linux-dependencies";
  } else if (missingLibraries.length > 0 && platform === "win32") {
    code = "missing-windows-dlls";
  } else if (/missing.*server|server.*missing/i.test(message)) {
    code = "missing-server";
  } else if (/before becoming ready|exited before/i.test(message)) {
    code = "runtime-execution-failed";
  }

  return {
    code,
    ...(reason ? { reason } : {}),
    ...(missingLibraries.length > 0 ? { missingLibraries } : {}),
    repairAction: llamaRuntimeRepairAction(code, reason),
  };
}