import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Check a merged release manifest, not just the source removal markers. */
export function verifyLocalOnlyManifest(xml) {
  const manifest = xml.match(/<manifest\b[^>]*>/)?.[0] ?? "";
  if (!/\bpackage\s*=\s*"ai\.pyri\.engram\.offline"/.test(manifest)) {
    throw new Error("Local-only package must have its separate .offline application sandbox.");
  }
  const application = xml.match(/<application\b[^>]*>/)?.[0] ?? "";
  if (!/\bandroid:allowBackup\s*=\s*"false"/.test(application)) {
    throw new Error("Local-only storage must not permit Android cloud backup.");
  }
  if (/\bandroid:debuggable\s*=\s*"true"/.test(application)) {
    throw new Error("A local-only release must not be debuggable.");
  }
  for (const [tag] of xml.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*>/g)) {
    if (
      /\bandroid:name\s*=\s*"android\.permission\.(?:INTERNET|ACCESS_NETWORK_STATE|CHANGE_NETWORK_STATE)"/.test(tag) &&
      !/\btools:node\s*=\s*"remove"/.test(tag)
    ) {
      throw new Error("Local-only package still grants network permissions.");
    }
  }
  return { applicationId: "ai.pyri.engram.offline", networkPermissions: false, cloudBackup: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error("Usage: node verify-local-only-manifest.mjs MERGED_ANDROID_MANIFEST");
    console.info(JSON.stringify(verifyLocalOnlyManifest(await readFile(process.argv[2], "utf8"))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
