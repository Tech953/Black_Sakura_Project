import * as FileSystem from "expo-file-system/legacy";
import spec from "./bundled-model-spec.json";

const ASSET_ROOT = "asset:///offline-model/";
let installation: Promise<void> | null = null;
let verifiedPath: string | null = null;

/** A build-time opt-in, independent of the ordinary downloadable-model build. */
export function hasPackagedChatModel(): boolean {
  return process.env.EXPO_PUBLIC_BUNDLED_CHAT_MODEL === "1";
}

type Manifest = typeof spec & { format: 1; md5: string };

function parseManifest(raw: string): Manifest {
  const data = JSON.parse(raw) as Partial<Manifest> | null;
  if (
    !data || data.format !== 1 ||
    data.filename !== spec.filename || data.bytes !== spec.bytes ||
    data.sha256 !== spec.sha256 || data.revision !== spec.revision ||
    data.license !== spec.license ||
    typeof data.md5 !== "string" || !/^[a-f0-9]{32}$/.test(data.md5)
  ) {
    throw new Error("The packaged chat model manifest is invalid. Reinstall the complete package.");
  }
  return data as Manifest;
}

/**
 * Extract only from the APK to private application storage. There is deliberately
 * no HTTP fallback. Native MD5 checks transport corruption; the build verifies
 * SHA-256 against the pinned upstream hash and APK signing protects the manifest.
 */
export function installPackagedChatModel(target: string): Promise<void> {
  if (!hasPackagedChatModel()) return Promise.resolve();
  if (installation) return installation;
  installation = install(target).finally(() => { installation = null; });
  return installation;
}

async function install(target: string): Promise<void> {
  const manifest = parseManifest(await FileSystem.readAsStringAsync(`${ASSET_ROOT}manifest.json`));
  const current = await FileSystem.getInfoAsync(target);
  if (current.exists && !current.isDirectory && current.size === spec.bytes) {
    if (verifiedPath === target) return;
    const checked = await FileSystem.getInfoAsync(target, { md5: true });
    if (checked.exists && checked.md5 === manifest.md5) {
      verifiedPath = target;
      return;
    }
  }
  verifiedPath = null;
  const temporary = `${target}.installing`;
  await FileSystem.makeDirectoryAsync(target.slice(0, target.lastIndexOf("/")), { intermediates: true });
  await FileSystem.deleteAsync(temporary, { idempotent: true });
  const free = await FileSystem.getFreeDiskStorageAsync().catch(() => null);
  if (free === null || free < Math.ceil(spec.bytes * 1.1)) {
    throw new Error("Cannot unpack the packaged chat model: at least 1.22 GB of verified free storage is required.");
  }
  try {
    await FileSystem.copyAsync({ from: `${ASSET_ROOT}${spec.filename}`, to: temporary });
    const copied = await FileSystem.getInfoAsync(temporary, { md5: true });
    if (
      !copied.exists || copied.isDirectory ||
      copied.size !== spec.bytes || copied.md5 !== manifest.md5
    ) {
      throw new Error("The packaged chat model failed its integrity check. Reinstall the complete package.");
    }
    // Preserve an existing model until its replacement has been verified.
    await FileSystem.deleteAsync(target, { idempotent: true });
    await FileSystem.moveAsync({ from: temporary, to: target });
    verifiedPath = target;
  } finally {
    await FileSystem.deleteAsync(temporary, { idempotent: true });
  }
}
