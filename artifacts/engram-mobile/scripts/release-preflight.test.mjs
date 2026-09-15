import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertApkFreshness,
  ensureLlamaNativeLibraries,
  verifyApk,
} from "./release-preflight.mjs";

const currentInputs = {
  packageName: "ai.pyri.engram",
  versionCode: 4,
  versionName: "1.0.2",
  allowBackup: false,
};

test("accepts APK metadata matching current Android build inputs", () => {
  assert.doesNotThrow(() =>
    assertApkFreshness(currentInputs, { ...currentInputs }),
  );
});

test("rejects stale APK privacy metadata with embedded and expected values", () => {
  const staleArtifact = {
    ...currentInputs,
    allowBackup: true,
  };

  assert.throws(
    () => assertApkFreshness(currentInputs, staleArtifact),
    (error) => {
      assert.match(
        error.message,
        /Release APK is stale relative to current Android build inputs/,
      );
      assert.match(error.message, /allowBackup: embedded true; expected false/);
      return true;
    },
  );
});

const requiredAbis = ["arm64-v8a", "x86_64"];

function makeTempDir() {
  return mkdtempSync(path.join(os.tmpdir(), "engram-release-preflight-test-"));
}

function writeNativeLibraries(root, abis = requiredAbis) {
  for (const abi of abis) {
    const dir = path.join(root, "android", "src", "main", "jniLibs", abi);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "librnllama.so"), "fixture");
  }
}

function writeDownloader(root) {
  const installDir = path.join(root, "install");
  mkdirSync(installDir, { recursive: true });
  writeFileSync(
    path.join(installDir, "download-native-artifacts.js"),
    "// fixture",
  );
}

function makeApkFixture(entries, { badging } = {}) {
  const directory = makeTempDir();
  const apkPath = path.join(directory, "app-release.apk");
  writeFileSync(apkPath, "not a real APK; command output is injected");
  const calls = [];
  const manifest = [
    "A: android:allowBackup(0x0101000f)=(type 0x12)0x0",
    "A: android:fullBackupContent(0x01010280)=(type 0x10)0x7f0f0001",
    "A: android:dataExtractionRules(0x010105b4)=(type 0x10)0x7f0f0002",
  ].join("\n");
  const permissions = [
    "package: ai.pyri.engram",
    "uses-permission: android.permission.INTERNET",
    "uses-permission: android.permission.VIBRATE",
  ].join("\n");

  function runCommand(command, args) {
    calls.push({ command, args });
    if (command === "unzip" && args[0] === "-Z1") {
      return `${entries.join("\n")}\n`;
    }
    if (args[0] === "dump" && args[1] === "badging") {
      return (
        badging ??
        "package: name='ai.pyri.engram' versionCode='4' versionName='1.0.2'\n"
      );
    }
    if (args[0] === "dump" && args[1] === "xmltree") return manifest;
    if (args[0] === "dump" && args[1] === "permissions") return permissions;
    if (args[0] === "dump" && args[1] === "resources") {
      return "resource backup_rules\nresource data_extraction_rules\n";
    }
    return "";
  }

  return {
    directory,
    apkPath,
    calls,
    runCommand,
    findTool: (name) => `/fixture/${name}`,
  };
}

test("passes a clean llama.rn install without running repair", () => {
  const root = makeTempDir();
  try {
    writeNativeLibraries(root);
    const calls = [];
    ensureLlamaNativeLibraries({
      root,
      runCommand: (...args) => calls.push(args),
    });
    assert.equal(calls.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repairs a llama.rn install with missing jniLibs", () => {
  const root = makeTempDir();
  try {
    let repairs = 0;
    writeDownloader(root);
    ensureLlamaNativeLibraries({
      root,
      runCommand: () => {
        repairs += 1;
        writeNativeLibraries(root);
      },
    });
    assert.equal(repairs, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails before running repair when the llama.rn downloader is missing", () => {
  const root = makeTempDir();
  try {
    let commands = 0;
    assert.throws(
      () =>
        ensureLlamaNativeLibraries({
          root,
          runCommand: () => {
            commands += 1;
          },
        }),
      (error) => {
        assert.equal(
          error.message,
          `llama.rn native artifact downloader not found at ${path.join(
            root,
            "install",
            "download-native-artifacts.js",
          )}`,
        );
        return true;
      },
    );
    assert.equal(commands, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails when llama.rn repair does not restore native libraries", () => {
  const root = makeTempDir();
  try {
    writeDownloader(root);
    assert.throws(
      () =>
        ensureLlamaNativeLibraries({
          root,
          runCommand: () => {},
        }),
      /native libraries are still missing for arm64-v8a, x86_64 after repair/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects an APK with one required ABI missing", () => {
  const fixture = makeApkFixture(["lib/arm64-v8a/librnllama.so"]);
  try {
    assert.throws(
      () =>
        verifyApk(fixture.apkPath, {
          expected: currentInputs,
          findTool: fixture.findTool,
          runCommand: fixture.runCommand,
        }),
      /ABI set is arm64-v8a; expected only arm64-v8a, x86_64/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects a missing APK before invoking Android tools", () => {
  const fixture = makeApkFixture([]);
  rmSync(fixture.apkPath);
  try {
    assert.throws(
      () =>
        verifyApk(fixture.apkPath, {
          expected: currentInputs,
          findTool: () => {
            throw new Error("Android tool should not run");
          },
          runCommand: () => {
            throw new Error("Command should not run");
          },
        }),
      /Release APK not found/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects an APK whose ABIs contain no librnllama entries", () => {
  const fixture = makeApkFixture([
    "lib/arm64-v8a/libother.so",
    "lib/x86_64/libother.so",
  ]);
  try {
    assert.throws(
      () =>
        verifyApk(fixture.apkPath, {
          expected: currentInputs,
          findTool: fixture.findTool,
          runCommand: fixture.runCommand,
        }),
      /missing librnllama native libraries for arm64-v8a, x86_64/i,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects an APK when aapt package metadata is malformed", () => {
  const fixture = makeApkFixture([], {
    badging: "package: name='ai.pyri.engram' versionCode='not-a-number'\n",
  });
  try {
    assert.throws(
      () =>
        verifyApk(fixture.apkPath, {
          expected: currentInputs,
          findTool: fixture.findTool,
          runCommand: fixture.runCommand,
        }),
      /Release APK package\/version metadata could not be read from aapt badging output/i,
    );
    assert.deepEqual(fixture.calls, [
      {
        command: "/fixture/aapt",
        args: ["dump", "badging", fixture.apkPath, "AndroidManifest.xml"],
      },
      {
        command: "/fixture/aapt",
        args: ["dump", "xmltree", fixture.apkPath, "AndroidManifest.xml"],
      },
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("rejects an APK with an unsupported extra ABI before alignment checks", () => {
  const fixture = makeApkFixture([
    "lib/arm64-v8a/librnllama.so",
    "lib/x86_64/librnllama.so",
    "lib/armeabi-v7a/librnllama.so",
  ]);
  try {
    assert.throws(
      () =>
        verifyApk(fixture.apkPath, {
          expected: currentInputs,
          findTool: fixture.findTool,
          runCommand: fixture.runCommand,
        }),
      /ABI set is arm64-v8a, armeabi-v7a, x86_64; expected only arm64-v8a, x86_64/i,
    );
    assert.equal(
      fixture.calls.some(({ command }) => command === "/fixture/zipalign"),
      false,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
