import { lstat, mkdir, realpath, statfs, symlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep reproducible AGP asset copies off a quota-constrained workspace.
// Never delete existing build output or move source models.
export async function prepareCompressionScratch({ buildDir, scratch, minimumBytes = 1600000000, apk = false }) {
  const build = path.resolve(buildDir);
  const target = path.resolve(scratch);
  if (target === build || target.startsWith(`${build}${path.sep}`)) {
    throw new Error("Scratch must be outside the Android app build directory.");
  }
  await mkdir(target, { recursive: true });
  const space = await statfs(target);
  const available = space.bavail * space.bsize;
  if (available < minimumBytes) throw new Error(`Scratch needs ${minimumBytes} bytes; available ${available}.`);
  const link = apk ? path.join(build, "outputs", "apk", "deviceLocal")
    : path.join(build, "intermediates", "compressed_assets");
  await mkdir(path.dirname(link), { recursive: true });
  const current = await lstat(link).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (current) {
    if (!current.isSymbolicLink() || await realpath(link) !== await realpath(target)) {
      throw new Error(`Refusing to replace existing output: ${link}`);
    }
  } else {
    await symlink(target, link, "dir");
  }
  return { link, target, available, note: "Filesystem headroom is not proof of workspace quota headroom." };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error("Usage: node android-compression-scratch.mjs APP_BUILD_DIR SCRATCH_DIR");
  const apk = process.argv.includes("--apk");
  console.log(JSON.stringify(await prepareCompressionScratch({
    buildDir: process.argv[2], scratch: process.argv[3], apk,
    minimumBytes: apk ? 2600000000 : 1600000000,
  })));
}
