import { createHash } from "node:crypto";
import {
  readFileSync,
  realpathSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import path from "node:path";
export function verifyRuntimeCandidate(root) {
  root = realpathSync(root);
  const manifest = JSON.parse(
    readFileSync(path.join(root, "windows-runtime-manifest.json"), "utf8"),
  );
  if (
    manifest.runtimeProbePassed !== true ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length
  )
    throw new Error("Runtime candidate has no successful probe/inventory.");
  const paths = new Set();
  for (const entry of manifest.files) {
    if (
      typeof entry.path !== "string" ||
      path.isAbsolute(entry.path) ||
      entry.path.includes("\\") ||
      entry.path.split("/").some((p) => !p || p === "." || p === "..") ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      paths.has(entry.path)
    )
      throw new Error("Invalid runtime inventory entry.");
    paths.add(entry.path);
    const file = realpathSync(path.join(root, entry.path));
    const relative = path.relative(root, file);
    if (
      relative === ".." ||
      relative.startsWith(".." + path.sep) ||
      path.isAbsolute(relative) ||
      !statSync(file).isFile()
    )
      throw new Error("Runtime asset escaped its bundle.");
    const fd = openSync(file, "r");
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024);
      let count;
      while ((count = readSync(fd, buffer)) > 0) {
        bytes += count;
        hash.update(buffer.subarray(0, count));
      }
    } finally {
      closeSync(fd);
    }
    if (bytes !== entry.bytes || hash.digest("hex") !== entry.sha256)
      throw new Error(`Runtime checksum mismatch: ${entry.path}`);
  }
  for (const name of [
    "python/python.exe",
    "models/manifest.json",
    "fonts/manifest.json",
    "vendor/espeak-ng/manifest.json",
    "vendor/llama-cpp/manifest.json",
  ]) {
    if (!paths.has(name))
      throw new Error(`Incomplete runtime candidate: ${name}`);
  }
  return {
    appRoot: root,
    pythonRoot: path.join(root, "python"),
    modelManifest: path.join(root, "models/manifest.json"),
  };
}
