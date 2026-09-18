import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { WINDOWS_RUNTIME_FILES } from "./llama-runtime-check.mjs";
import { verifyWindowsZip } from "./verify-windows-zip.mjs";

function peFixture(extraByte = null) {
  const bytes = Buffer.alloc(0x40 + 6 + (extraByte === null ? 0 : 1));
  bytes[0] = 0x4d;
  bytes[1] = 0x5a;
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.set([0x50, 0x45, 0, 0], 0x40);
  bytes.writeUInt16LE(0x8664, 0x44);
  if (extraByte !== null) bytes[0x46] = extraByte;
  return bytes;
}

function createPackageRoot(root, { executable = peFixture() } = {}) {
  const llamaBin = path.join(root, "resources", "llama", "bin");
  const pgliteDist = path.join(
    root,
    "resources",
    "server",
    "node_modules",
    "@electric-sql",
    "pglite",
    "dist",
  );
  mkdirSync(llamaBin, { recursive: true });
  mkdirSync(pgliteDist, { recursive: true });
  mkdirSync(path.join(root, "resources", "web"), { recursive: true });
  writeFileSync(path.join(root, "engram.exe"), executable);
  writeFileSync(path.join(llamaBin, "llama-server.exe"), peFixture());
  for (const dll of WINDOWS_RUNTIME_FILES) {
    writeFileSync(path.join(llamaBin, dll), "dll");
  }
  writeFileSync(
    path.join(root, "resources", "server", "index.mjs"),
    "export {};\n",
  );
  writeFileSync(path.join(pgliteDist, "pglite.wasm"), "wasm");
  writeFileSync(path.join(pgliteDist, "pglite.data"), "data");
  writeFileSync(path.join(root, "resources", "web", "index.html"), "<html />");
}

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "engram-windows-zip-"));
  const unpackedDir = path.join(root, "win-unpacked");
  const extractedDir = path.join(root, "zip-extracted");
  createPackageRoot(unpackedDir);
  createPackageRoot(extractedDir);
  const zipPath = path.join(root, "ENGRAM-test-x64.zip");
  writeFileSync(zipPath, "portable zip fixture");
  const diagnosticsPath = path.join(root, "diagnostics", "windows-zip.json");
  return { root, unpackedDir, extractedDir, zipPath, diagnosticsPath };
}

describe("Windows ZIP completeness check", () => {
  it("validates both package trees and compares the executable hash", async () => {
    const paths = fixture();
    const result = await verifyWindowsZip(paths);

    expect(result.ok).toBe(true);
    expect(result.zipSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.executableSha256["win-unpacked"]).toBe(
      result.executableSha256["windows-zip"],
    );
    const { readFileSync } = await import("node:fs");
    expect(JSON.parse(readFileSync(paths.diagnosticsPath, "utf8")).ok).toBe(
      true,
    );
  });

  it("reports a missing llama DLL with its extracted path and keeps the ZIP hash", async () => {
    const paths = fixture();
    const missing = path.join(
      paths.extractedDir,
      "resources",
      "llama",
      "bin",
      WINDOWS_RUNTIME_FILES[0],
    );
    writeFileSync(missing, "");
    const { rmSync } = await import("node:fs");
    rmSync(missing);

    await expect(verifyWindowsZip(paths)).rejects.toThrow(
      new RegExp(`missing required llama DLL .*${WINDOWS_RUNTIME_FILES[0]}`),
    );
    const diagnostics = await import("node:fs").then(({ readFileSync }) =>
      JSON.parse(readFileSync(paths.diagnosticsPath, "utf8")),
    );
    expect(diagnostics.zipSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an executable that differs from win-unpacked", async () => {
    const paths = fixture();
    writeFileSync(
      path.join(paths.extractedDir, "engram.exe"),
      peFixture(0x7f),
    );

    await expect(verifyWindowsZip(paths)).rejects.toThrow(
      /Windows ZIP executable does not match win-unpacked/,
    );
  });

  it("rejects a default GGUF in a slim package", async () => {
    const paths = fixture();
    writeFileSync(
      path.join(paths.extractedDir, "resources", "llama", "model.gguf"),
      "model",
    );

    await expect(verifyWindowsZip(paths)).rejects.toThrow(
      /slim Windows package unexpectedly contains the default GGUF/,
    );
  });
});