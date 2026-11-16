import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { verifyLocalOnlyManifest } from "./verify-local-only-manifest.mjs";

const manifest = `<manifest package="ai.pyri.engram.offline">
  <application android:allowBackup="false" />
</manifest>`;

test("permits a separate, non-debuggable local sandbox with no network or cloud backup", () => {
  assert.equal(verifyLocalOnlyManifest(manifest).networkPermissions, false);
});
test("rejects a cloud app ID or backup permission", () => {
  assert.throws(() => verifyLocalOnlyManifest(manifest.replace(".offline", "")), /sandbox/);
  assert.throws(() => verifyLocalOnlyManifest(manifest.replace('allowBackup="false"', 'allowBackup="true"')), /backup/);
});
test("rejects effective network permissions, including SDK-23 declarations", () => {
  for (const tag of ["uses-permission", "uses-permission-sdk-23"]) {
    const xml = manifest.replace("<application", `<${tag} android:name="android.permission.INTERNET"/><application`);
    assert.throws(() => verifyLocalOnlyManifest(xml), /network permissions/);
  }
});
test("rejects a debuggable release", () => {
  assert.throws(() => verifyLocalOnlyManifest(manifest.replace("<application", '<application android:debuggable="true"')), /debuggable/);
});
test("native overlay and flavor preserve the local-only boundary", async () => {
  const overlay = await readFile(new URL("./local-only.AndroidManifest.xml", import.meta.url), "utf8");
  const gradle = await readFile(new URL("./bundled-chat-model.gradle", import.meta.url), "utf8");
  assert.match(overlay, /android:name="android.permission.INTERNET" tools:node="remove"/);
  assert.match(overlay, /android:allowBackup="false"/);
  assert.match(gradle, /EXPO_PUBLIC_LOCAL_ONLY/);
  assert.match(gradle, /applicationIdSuffix "\.offline"/);
  assert.match(gradle, /if \(localOnly && !bundleChatModel\)/);
});
