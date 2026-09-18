import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  llamaRuntimeFailureMessage,
  llamaRuntimeRepairAction,
} from "./llama-runtime-diagnosis.mjs";

const LINUX_PACKAGE_HINTS = {
  "libgcc_s.so.1": "libgcc-s1",
  "libstdc++.so.6": "libstdc++6",
  "libssl.so.3": "libssl3",
  "libcrypto.so.3": "libssl3",
  "libgomp.so.1": "libgomp1",
};

const MACOS_RUNTIME_FILES = {
  x64: [
    "libggml.0.18.0.dylib",
    "libggml-base.0.18.0.dylib",
    "libggml-cpu.0.18.0.dylib",
    "libllama.0.0.10242.dylib",
    "libllama-common.0.0.10242.dylib",
    "libllama-server-impl.dylib",
    "libmtmd.0.0.10242.dylib",
  ],
  arm64: [
    "libggml.0.18.0.dylib",
    "libggml-base.0.18.0.dylib",
    "libggml-cpu.0.18.0.dylib",
    "libggml-metal.0.18.0.dylib",
    "libllama.0.0.10242.dylib",
    "libllama-common.0.0.10242.dylib",
    "libllama-server-impl.dylib",
    "libmtmd.0.0.10242.dylib",
  ],
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

const ELF_MACHINES = {
  3: "ia32",
  62: "x64",
  183: "arm64",
};
const MACH_CPU_TYPES = {
  0x01000007: "x64",
  0x0100000c: "arm64",
  7: "ia32",
};
const PE_MACHINES = {
  0x014c: "ia32",
  0x8664: "x64",
  0xaa64: "arm64",
};

function architectureFromMachCpuType(cpuType) {
  return MACH_CPU_TYPES[cpuType & 0xffffffff];
}

function readElfArchitectures(bytes) {
  if (
    bytes.length < 20 ||
    bytes[0] !== 0x7f ||
    bytes[1] !== 0x45 ||
    bytes[2] !== 0x4c ||
    bytes[3] !== 0x46
  ) {
    return [];
  }
  const littleEndian = bytes[5] === 1;
  const machine = littleEndian
    ? bytes.readUInt16LE(18)
    : bytes.readUInt16BE(18);
  const architecture = ELF_MACHINES[machine];
  return architecture ? [architecture] : [];
}

function readMachArchitectures(bytes) {
  if (bytes.length < 8) return [];
  const littleMagic = bytes.readUInt32LE(0);
  const bigMagic = bytes.readUInt32BE(0);
  const thinLittle =
    littleMagic === 0xfeedface || littleMagic === 0xfeedfacf;
  const thinBig = bigMagic === 0xfeedface || bigMagic === 0xfeedfacf;
  if (thinLittle || thinBig) {
    const cpuType = thinLittle
      ? bytes.readUInt32LE(4)
      : bytes.readUInt32BE(4);
    const architecture = architectureFromMachCpuType(cpuType);
    return architecture ? [architecture] : [];
  }

  const fatMagic =
    bigMagic === 0xcafebabe ||
    bigMagic === 0xcafebabf ||
    littleMagic === 0xbebafeca ||
    littleMagic === 0xbfbafeca;
  if (!fatMagic) return [];
  const littleEndian =
    bigMagic === 0xbebafeca || bigMagic === 0xbfbafeca;
  const fat64 =
    bigMagic === 0xcafebabf || littleMagic === 0xbfbafeca;
  const count = littleEndian
    ? bytes.readUInt32LE(4)
    : bytes.readUInt32BE(4);
  const entrySize = fat64 ? 32 : 20;
  const architectures = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 8 + index * entrySize;
    if (offset + 4 > bytes.length) break;
    const cpuType = littleEndian
      ? bytes.readUInt32LE(offset)
      : bytes.readUInt32BE(offset);
    const architecture = architectureFromMachCpuType(cpuType);
    if (architecture) architectures.push(architecture);
  }
  return unique(architectures);
}

function readPeArchitectures(bytes) {
  if (
    bytes.length < 0x40 ||
    bytes[0] !== 0x4d ||
    bytes[1] !== 0x5a
  ) {
    return [];
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (
    peOffset < 0 ||
    peOffset + 6 > bytes.length ||
    bytes[peOffset] !== 0x50 ||
    bytes[peOffset + 1] !== 0x45 ||
    bytes[peOffset + 2] !== 0 ||
    bytes[peOffset + 3] !== 0
  ) {
    return [];
  }
  const machine = bytes.readUInt16LE(peOffset + 4);
  const architecture = PE_MACHINES[machine];
  return architecture ? [architecture] : [];
}

export function inspectLlamaRuntimeArchitecture(executablePath) {
  let bytes;
  try {
    bytes = readFileSync(executablePath);
  } catch (error) {
    return {
      ok: false,
      details: `could not read executable: ${error?.message ?? error}`,
    };
  }
  const architectures = unique([
    ...readElfArchitectures(bytes),
    ...readMachArchitectures(bytes),
    ...readPeArchitectures(bytes),
  ]);
  if (architectures.length === 0) {
    return {
      ok: false,
      details: "unrecognized ELF, Mach-O, or PE executable format",
    };
  }
  return { ok: true, architectures };
}

export function checkLlamaRuntimeArchitecture({
  executablePath,
  platform,
  architecture,
}) {
  const inspected = inspectLlamaRuntimeArchitecture(executablePath);
  if (!inspected.ok) {
    return {
      ok: false,
      code: "runtime-architecture-unreadable",
      repairAction: llamaRuntimeRepairAction("runtime-architecture-unreadable"),
      message: llamaRuntimeFailureMessage({
        code: "runtime-architecture-unreadable",
        executablePath,
        platform,
        architecture,
        details: inspected.details,
      }),
    };
  }
  if (!inspected.architectures.includes(architecture)) {
    const detected = inspected.architectures.join(", ");
    return {
      ok: false,
      code: "runtime-architecture-mismatch",
      detectedArchitectures: inspected.architectures,
      repairAction: llamaRuntimeRepairAction("runtime-architecture-mismatch"),
      message: llamaRuntimeFailureMessage({
        code: "runtime-architecture-mismatch",
        executablePath,
        platform,
        architecture,
        details: detected,
      }),
    };
  }
  return { ok: true, architectures: inspected.architectures };
}

function runtimeExecutionCheck(
  executablePath,
  platform,
  architecture,
  env,
) {
  const result = spawnSync(executablePath, ["--version"], {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (!result.error) {
    return { ok: true, code: "runtime-executable" };
  }

  const errorCode = String(result.error.code ?? "").toUpperCase();
  if (errorCode === "EACCES" || errorCode === "EPERM") {
    const reason = "permission-denied";
    return {
      ok: false,
      code: "runtime-not-executable",
      reason,
      repairAction: llamaRuntimeRepairAction("runtime-not-executable", reason),
      message: llamaRuntimeFailureMessage({
        code: "runtime-not-executable",
        reason,
        executablePath,
        platform,
        architecture,
      }),
    };
  }
  if (errorCode === "ENOEXEC") {
    const reason = "exec-format-error";
    return {
      ok: false,
      code: "runtime-not-executable",
      reason,
      repairAction: llamaRuntimeRepairAction("runtime-not-executable", reason),
      message: llamaRuntimeFailureMessage({
        code: "runtime-not-executable",
        reason,
        executablePath,
        platform,
        architecture,
      }),
    };
  }

  return {
    ok: false,
    code: "runtime-execution-failed",
    repairAction: llamaRuntimeRepairAction("runtime-execution-failed"),
    message: llamaRuntimeFailureMessage({
      code: "runtime-execution-failed",
      executablePath,
      details: result.error.message,
    }),
  };
}

function inspectRuntimeExecution(
  dependencyResult,
  executablePath,
  platform,
  architecture,
  env,
) {
  // Missing libraries/DLLs and unavailable inspection tools already have more
  // actionable diagnoses. Probe after a successful inspection, or after the
  // generic ldd/otool failure that can itself be caused by a bad executable.
  if (
    !dependencyResult.ok &&
    !["ldd-failed", "otool-failed"].includes(dependencyResult.code)
  ) {
    return dependencyResult;
  }
  const executionResult = runtimeExecutionCheck(
    executablePath,
    platform,
    architecture,
    env,
  );
  return executionResult.ok ? dependencyResult : executionResult;
}

const SUPPORTED_ARCHITECTURES = {
  linux: ["x64", "arm64"],
  darwin: ["x64", "arm64"],
  win32: ["x64"],
};

function unsupportedArchitecture(platform, architecture) {
  return {
    ok: false,
    code: "unsupported-architecture",
    repairAction: llamaRuntimeRepairAction("unsupported-architecture"),
    message: llamaRuntimeFailureMessage({
      code: "unsupported-architecture",
      platform,
      architecture,
    }),
  };
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
      repairAction: llamaRuntimeRepairAction("ldd-unavailable"),
      message: llamaRuntimeFailureMessage({
        code: "ldd-unavailable",
        details: result.error.message,
      }),
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
      repairAction: llamaRuntimeRepairAction("ldd-failed"),
      message: llamaRuntimeFailureMessage({
        code: "ldd-failed",
        executablePath,
        details: output.trim() || `ldd exited with status ${result.status}`,
      }),
    };
  }
  if (missing.length > 0) {
    const packageNames = unique(
      missing.map((name) => LINUX_PACKAGE_HINTS[name]).filter(Boolean),
    );
    return {
      ok: false,
      code: "missing-linux-dependencies",
      missing,
      missingLibraries: missing,
      repairAction: llamaRuntimeRepairAction("missing-linux-dependencies"),
      message: llamaRuntimeFailureMessage({
        code: "missing-linux-dependencies",
        executablePath,
        missingLibraries: missing,
        packageNames,
      }),
    };
  }

  return { ok: true, code: "linux-dependencies-resolved" };
}

function macOSDependencyCheck(executablePath, architecture) {
  const required = MACOS_RUNTIME_FILES[architecture];
  if (!required) return unsupportedArchitecture("darwin", architecture);

  const result = spawnSync("otool", ["-L", executablePath], {
    encoding: "utf8",
  });
  if (result.error) {
    return {
      ok: false,
      code: "otool-unavailable",
      repairAction: llamaRuntimeRepairAction("otool-unavailable"),
      message: llamaRuntimeFailureMessage({
        code: "otool-unavailable",
        details: result.error.message,
      }),
    };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status !== 0) {
    return {
      ok: false,
      code: "otool-failed",
      repairAction: llamaRuntimeRepairAction("otool-failed"),
      message: llamaRuntimeFailureMessage({
        code: "otool-failed",
        executablePath,
        details: output.trim() || `otool exited with status ${result.status}`,
      }),
    };
  }

  const referenced = unique(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(
        (name) => name && (name.startsWith("@rpath/") || name.startsWith("@loader_path/")),
      )
      .map((name) => path.basename(name)),
  );
  const binDir = path.dirname(executablePath);
  const missing = unique([...required, ...referenced]).filter(
    (name) => !existsSync(path.join(binDir, name)),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      code: "missing-macos-dylibs",
      missing,
      missingLibraries: missing,
      repairAction: llamaRuntimeRepairAction("missing-macos-dylibs"),
      message: llamaRuntimeFailureMessage({
        code: "missing-macos-dylibs",
        executablePath,
        architecture,
        missingLibraries: missing,
      }),
    };
  }

  return {
    ok: true,
    code: "macos-dylibs-present",
    architecture,
  };
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
      missingLibraries: missing,
      repairAction: llamaRuntimeRepairAction("missing-windows-dlls"),
      message: llamaRuntimeFailureMessage({
        code: "missing-windows-dlls",
        executablePath,
        missingLibraries: missing,
      }),
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
  architecture = process.arch,
  env = process.env,
}) {
  if (!existsSync(executablePath)) {
    return {
      ok: false,
      code: "missing-server",
      repairAction: llamaRuntimeRepairAction("missing-server"),
      message: llamaRuntimeFailureMessage({
        code: "missing-server",
        executablePath,
      }),
    };
  }
  const supported = SUPPORTED_ARCHITECTURES[platform];
  if (supported && !supported.includes(architecture)) {
    return unsupportedArchitecture(platform, architecture);
  }
  if (supported) {
    const architectureResult = checkLlamaRuntimeArchitecture({
      executablePath,
      platform,
      architecture,
    });
    if (!architectureResult.ok) return architectureResult;
  }
  if (platform === "linux") {
    return inspectRuntimeExecution(
      linuxDependencyCheck(executablePath, env),
      executablePath,
      platform,
      architecture,
      env,
    );
  }
  if (platform === "darwin") {
    return inspectRuntimeExecution(
      macOSDependencyCheck(executablePath, architecture),
      executablePath,
      platform,
      architecture,
      env,
    );
  }
  if (platform === "win32") {
    return inspectRuntimeExecution(
      windowsDependencyCheck(executablePath),
      executablePath,
      platform,
      architecture,
      env,
    );
  }
  return {
    ok: true,
    code: "platform-not-inspected",
    message: `llama.cpp dependency inspection is not configured for ${platform}.`,
  };
}