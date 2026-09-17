import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

const { checkLlamaRuntime } = await import("./llama-runtime-check.mjs");

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedSpawnSync = vi.mocked(spawnSync);

describe("checkLlamaRuntime", () => {
  const executablePath = "/fixture/resources/llama/bin/llama-server";

  beforeEach(() => {
    vi.resetAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([]);
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });
  });

  it("reports missing Linux libraries and deduplicated Debian package guidance", () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: [
        "libstdc++.so.6 => not found",
        "libssl.so.3 => not found",
        "libcrypto.so.3 => not found",
        "libgomp.so.1 => not found",
        "libssl.so.3 => not found",
      ].join("\n"),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
      env: { LD_LIBRARY_PATH: "/fixture/lib" },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "missing-linux-dependencies",
      missing: [
        "libstdc++.so.6",
        "libssl.so.3",
        "libcrypto.so.3",
        "libgomp.so.1",
      ],
    });
    expect(result.message).toContain(
      "Debian/Ubuntu: libstdc++6, libssl3, libgomp1",
    );
    expect(result.message).toContain("AppImage users must provide equivalent libraries");
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "ldd",
      [executablePath],
      expect.objectContaining({
        encoding: "utf8",
        env: { LD_LIBRARY_PATH: "/fixture/lib" },
      }),
    );
  });

  it("reports when ldd itself is unavailable", () => {
    mockedSpawnSync.mockReturnValue({
      error: new Error("spawn ldd ENOENT"),
      status: null,
      stdout: "",
      stderr: "",
      pid: undefined,
      output: [],
      signal: null,
    });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "ldd-unavailable",
    });
    expect(result.message).toContain("Run the packaged smoke test on a Linux host");
  });

  it("reports an ldd inspection failure without inventing missing libraries", () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: "not a dynamic executable",
      stderr: "ldd: warning: unsupported format",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
    });

    expect(result).toEqual({
      ok: false,
      code: "ldd-failed",
      message: expect.stringContaining("not a dynamic executable"),
    });
  });

  it("reports an existing runtime that lacks execute permission", () => {
    mockedSpawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: "libstdc++.so.6 => /lib/libstdc++.so.6 (0x00007f)\n",
        stderr: "",
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        error: Object.assign(new Error("spawn EACCES"), { code: "EACCES" }),
        status: null,
        stdout: "",
        stderr: "",
        pid: undefined,
        output: [],
        signal: null,
      });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
      architecture: "x64",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "runtime-not-executable",
      reason: "permission-denied",
    });
    expect(result.message).toContain("chmod +x");
    expect(result.message).toContain(executablePath);
    expect(mockedSpawnSync).toHaveBeenLastCalledWith(
      executablePath,
      ["--version"],
      expect.objectContaining({
        encoding: "utf8",
        env: process.env,
      }),
    );
  });

  it("reports an existing runtime with an execution-format error", () => {
    mockedSpawnSync
      .mockReturnValueOnce({
        status: 1,
        stdout: "not a dynamic executable",
        stderr: "ldd: unsupported format",
        pid: 1,
        output: [],
        signal: null,
      })
      .mockReturnValueOnce({
        error: Object.assign(new Error("spawn ENOEXEC"), { code: "ENOEXEC" }),
        status: null,
        stdout: "",
        stderr: "",
        pid: undefined,
        output: [],
        signal: null,
      });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
      architecture: "x64",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "runtime-not-executable",
      reason: "exec-format-error",
    });
    expect(result.message).toContain("execution-format error");
    expect(result.message).toContain("linux-x64");
  });

  it("accepts a Linux runtime when ldd has no unresolved dependencies", () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: "libstdc++.so.6 => /lib/libstdc++.so.6 (0x00007f)\n",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    expect(
      checkLlamaRuntime({ executablePath, platform: "linux" }),
    ).toEqual({
      ok: true,
      code: "linux-dependencies-resolved",
    });
  });

  it("checks Linux ARM64 with the same host-library contract", () => {
    mockedSpawnSync.mockReturnValue({
      status: 1,
      stdout: "libgomp.so.1 => not found\n",
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "linux",
      architecture: "arm64",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "missing-linux-dependencies",
      missing: ["libgomp.so.1"],
    });
    expect(result.message).toContain("Debian/Ubuntu: libgomp1");
  });

  it("checks macOS x64 dylibs with otool and no Metal dependency", () => {
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: [
        `${executablePath}:`,
        "\t@rpath/libllama-server-impl.dylib",
        "\t@rpath/libggml-cpu.0.18.0.dylib",
        "\t/usr/lib/libSystem.B.dylib",
      ].join("\n"),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    expect(
      checkLlamaRuntime({
        executablePath,
        platform: "darwin",
        architecture: "x64",
      }),
    ).toMatchObject({
      ok: true,
      code: "macos-dylibs-present",
      architecture: "x64",
    });
    expect(mockedSpawnSync).toHaveBeenCalledWith(
      "otool",
      ["-L", executablePath],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("requires the Metal dylib for macOS ARM64", () => {
    const metalDylib = "libggml-metal.0.18.0.dylib";
    mockedExistsSync.mockImplementation((candidate) => {
      return !String(candidate).endsWith(metalDylib);
    });
    mockedSpawnSync.mockReturnValue({
      status: 0,
      stdout: [
        `${executablePath}:`,
        `\t@rpath/${metalDylib}`,
        "\t@rpath/libllama-server-impl.dylib",
      ].join("\n"),
      stderr: "",
      pid: 1,
      output: [],
      signal: null,
    });

    const result = checkLlamaRuntime({
      executablePath,
      platform: "darwin",
      architecture: "arm64",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "missing-macos-dylibs",
      missing: [metalDylib],
    });
  });

  it("reports unsupported target architectures instead of skipping inspection", () => {
    const result = checkLlamaRuntime({
      executablePath,
      platform: "darwin",
      architecture: "ia32",
    });

    expect(result).toEqual({
      ok: false,
      code: "unsupported-architecture",
      message:
        "No pinned llama.cpp runtime dependency contract exists for darwin-ia32.",
    });
    expect(mockedSpawnSync).not.toHaveBeenCalled();
  });

  it("reports a missing adjacent Windows DLL without reading host files", () => {
    const windowsExecutablePath =
      "C:\\fixture\\resources\\llama\\bin\\llama-server.exe";
    const missingDll = "llama-common.dll";
    mockedExistsSync.mockImplementation((candidate) => {
      if (candidate === windowsExecutablePath) return true;
      return !String(candidate).endsWith(missingDll);
    });

    const result = checkLlamaRuntime({
      executablePath: windowsExecutablePath,
      platform: "win32",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "missing-windows-dlls",
      missing: [missingDll],
    });
    expect(result.message).toContain("Re-stage the complete pinned win-cpu-x64 llama.cpp archive");
    expect(mockedReaddirSync).not.toHaveBeenCalled();
  });

  it("accepts a complete Windows runtime and reports the DLL count", () => {
    mockedReaddirSync.mockReturnValue([
      "llama-server.exe",
      "ggml.dll",
      "ggml-base.dll",
      "ggml-cpu-x64.dll",
      "llama.dll",
      "llama-common.dll",
      "llama-server-impl.dll",
      "libomp140.x86_64.dll",
      "README.txt",
    ]);

    expect(
      checkLlamaRuntime({
        executablePath: "C:\\fixture\\resources\\llama\\bin\\llama-server.exe",
        platform: "win32",
      }),
    ).toMatchObject({
      ok: true,
      code: "windows-dlls-present",
      dllCount: 7,
    });
  });

  it("reports a missing packaged server before platform-specific inspection", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(
      checkLlamaRuntime({ executablePath, platform: "linux" }),
    ).toEqual({
      ok: false,
      code: "missing-server",
      message: `Packaged llama.cpp server is missing: ${executablePath}`,
    });
    expect(mockedSpawnSync).not.toHaveBeenCalled();
    expect(mockedReaddirSync).not.toHaveBeenCalled();
  });
});