import assert from "node:assert/strict";
import test from "node:test";

import { assertApkFreshness } from "./release-preflight.mjs";

const currentInputs = {
  packageName: "ai.pyri.engram",
  versionCode: 4,
  versionName: "1.0.2",
  allowBackup: false,
};

test("accepts APK metadata matching current Android build inputs", () => {
  assert.doesNotThrow(() => assertApkFreshness(currentInputs, { ...currentInputs }));
});

test("rejects stale APK privacy metadata with embedded and expected values", () => {
  const staleArtifact = {
    ...currentInputs,
    allowBackup: true,
  };

  assert.throws(
    () => assertApkFreshness(currentInputs, staleArtifact),
    (error) => {
      assert.match(error.message, /Release APK is stale relative to current Android build inputs/);
      assert.match(error.message, /allowBackup: embedded true; expected false/);
      return true;
    },
  );
});