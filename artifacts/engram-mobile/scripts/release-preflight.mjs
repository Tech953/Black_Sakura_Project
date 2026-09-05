#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredAbis = ["arm64-v8a", "x86_64"];
const minimumArm64LoadAlignment = 0x4000n;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? mobileRoot,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
    }
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result.stdout ?? "";
}

function llamaRoot() {
  const linkedRoot = path.join(mobileRoot, "node_modules", "llama.rn");
  if (!existsSync(linkedRoot)) {
    throw new Error(
      `llama.rn is not installed at ${linkedRoot}. Run pnpm install before the release preflight.`,
    );
  }
  return realpathSync(linkedRoot);
}

function missingNativeLibraries(root) {
  const jniRoot = path.join(root, "android", "src", "main", "jniLibs");
  if (!existsSync(jniRoot) || !statSync(jniRoot).isDirectory()) {
    return requiredAbis;
  }
  return requiredAbis.filter((abi) => {
    const library = path.join(jniRoot, abi, "librnllama.so");
    return !existsSync(library) || !statSync(library).isFile();
  });
}

function ensureLlamaNativeLibraries() {
  const root = llamaRoot();
  let missing = missingNativeLibraries(root);
  if (missing.length > 0) {
    console.warn(
      `llama.rn native libraries missing for ${missing.join(", ")}; downloading package artifacts...`,
    );
    const downloader = path.join(root, "install", "download-native-artifacts.js");
    if (!existsSync(downloader)) {
      throw new Error(`llama.rn native artifact downloader not found at ${downloader}`);
    }
    run(process.execPath, ["./install/download-native-artifacts.js"], { cwd: root });
    missing = missingNativeLibraries(root);
  }
  if (missing.length > 0) {
    throw new Error(
      `llama.rn native libraries are still missing for ${missing.join(", ")} after repair.`,
    );
  }
  console.log(`llama.rn native libraries ready for ${requiredAbis.join(", ")}.`);
}

function checkExpoPackageVersions() {
  console.log("Checking Expo package compatibility...");
  run("pnpm", ["exec", "expo", "install", "--check"]);
  console.log("Expo package versions match the installed SDK.");
}

function findAndroidBuildTool(name) {
  const sdkRoots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    path.resolve(mobileRoot, "../..", ".android-sdk"),
  ].filter(Boolean);
  for (const sdkRoot of sdkRoots) {
    const buildToolsRoot = path.join(sdkRoot, "build-tools");
    if (!existsSync(buildToolsRoot)) continue;
    const versions = readdirSync(buildToolsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const tool = path.join(buildToolsRoot, version, name);
      if (existsSync(tool)) return tool;
    }
  }
  throw new Error(
    `${name} was not found in Android SDK build-tools; set ANDROID_HOME before APK verification.`,
  );
}

function verifyArm64ElfAlignment(apkPath) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "engram-apk-"));
  try {
    run("unzip", ["-qq", apkPath, "lib/arm64-v8a/*.so", "-d", tempDir], {
      capture: true,
    });
    const libraryDir = path.join(tempDir, "lib", "arm64-v8a");
    const libraries = readdirSync(libraryDir)
      .filter((name) => name.endsWith(".so"))
      .sort();
    if (libraries.length === 0) {
      throw new Error("Release APK has no arm64-v8a shared libraries.");
    }
    for (const library of libraries) {
      const output = run("readelf", ["-lW", path.join(libraryDir, library)], {
        capture: true,
      });
      const alignments = output
        .split(/\r?\n/)
        .filter((line) => /^\s*LOAD\s/.test(line))
        .map((line) => line.trim().split(/\s+/).at(-1))
        .filter(Boolean);
      if (alignments.length === 0) {
        throw new Error(`Could not read ELF LOAD segments from ${library}.`);
      }
      const incompatible = alignments.find(
        (alignment) => BigInt(alignment) < minimumArm64LoadAlignment,
      );
      if (incompatible) {
        throw new Error(
          `${library} has ELF LOAD alignment ${incompatible}; Android 15/16 requires at least 0x4000.`,
        );
      }
    }
    console.log(
      `Release APK arm64 libraries are 16 KB compatible (${libraries.length} checked).`,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function verifyApk(apkPath) {
  const resolved = path.resolve(process.cwd(), apkPath);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) {
    throw new Error(`Release APK not found at ${resolved}`);
  }
  const entries = run("unzip", ["-Z1", resolved], { capture: true })
    .split(/\r?\n/)
    .filter(Boolean);
  const packagedAbis = [
    ...new Set(
      entries
        .map((entry) => /^lib\/([^/]+)\//.exec(entry)?.[1])
        .filter(Boolean),
    ),
  ].sort();
  const missingAbis = requiredAbis.filter((abi) => !packagedAbis.includes(abi));
  const unsupportedAbis = packagedAbis.filter((abi) => !requiredAbis.includes(abi));
  if (missingAbis.length > 0 || unsupportedAbis.length > 0) {
    throw new Error(
      `Release APK ABI set is ${packagedAbis.join(", ") || "<empty>"}; expected only ${requiredAbis.join(", ")}.`,
    );
  }
  const missing = requiredAbis.filter(
    (abi) =>
      !entries.some(
        (entry) =>
          entry.startsWith(`lib/${abi}/`) &&
          path.posix.basename(entry).startsWith("librnllama") &&
          entry.endsWith(".so"),
      ),
  );
  if (missing.length > 0) {
    throw new Error(
      `Release APK is missing librnllama native libraries for ${missing.join(", ")}.`,
    );
  }
  const packaged = entries.filter(
    (entry) =>
      entry.startsWith("lib/") &&
      path.posix.basename(entry).startsWith("librnllama") &&
      entry.endsWith(".so"),
  );
  console.log(`Release APK contains ${packaged.length} librnllama libraries.`);
  const zipalign = findAndroidBuildTool("zipalign");
  run(zipalign, ["-c", "-P", "16", "-v", "4", resolved], { capture: true });
  console.log("Release APK passes 16 KB ZIP alignment verification.");
  verifyArm64ElfAlignment(resolved);
}

function parseArgs(argv) {
  let skipExpo = false;
  let apkPath = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-expo") {
      skipExpo = true;
    } else if (arg === "--apk") {
      apkPath = argv[index + 1] ?? null;
      index += 1;
      if (!apkPath) throw new Error("--apk requires a file path");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { skipExpo, apkPath };
}

try {
  const { skipExpo, apkPath } = parseArgs(process.argv.slice(2));
  if (!skipExpo) checkExpoPackageVersions();
  ensureLlamaNativeLibraries();
  if (apkPath) verifyApk(apkPath);
  console.log("Mobile release dependency preflight passed.");
} catch (error) {
  console.error(`Mobile release dependency preflight failed: ${error.message}`);
  process.exitCode = 1;
}