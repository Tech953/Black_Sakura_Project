import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveStoredDesktopDownload } from "./download-storage";

// Repo-root-relative default downloads dir, resolved cwd-independently. After
// esbuild bundles the server into a single dist file, import.meta.url points at
// that one output file regardless of which source module this code lives in, so
// the repo root is three levels up (dist/ -> artifacts/api-server -> repo). Dev
// also builds and runs the bundled file, so this holds there too — process.cwd()
// is NOT reliable (prod runs from the repo root, dev from the package dir).
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(moduleDir, "..", "..", "..");
export const DEFAULT_DOWNLOADS_DIR = path.join(REPO_ROOT, "downloads");

export const APK_MIME = "application/vnd.android.package-archive";
export const OCTET_MIME = "application/octet-stream";

// Only ever interpolate an owner/repo that matches this shape into a GitHub API
// URL; anything else falls back to the project default.
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Repo used for BOTH the apk and desktop GitHub fallback. */
function downloadsRepo(): string {
  const v = process.env["DOWNLOADS_GITHUB_REPO"]?.trim();
  return v && REPO_RE.test(v) ? v : "Tech953/Ch-IO";
}

/** The apk may target a different repo than desktop via the older env name. */
function apkRepo(): string {
  const v = process.env["ANDROID_APK_GITHUB_REPO"]?.trim();
  return v && REPO_RE.test(v) ? v : downloadsRepo();
}

function downloadsDir(): string {
  return process.env["ANDROID_APK_DIR"]?.trim() || DEFAULT_DOWNLOADS_DIR;
}

/** Sanitize a filename for a Content-Disposition header (no quotes/control). */
export function safeAttachment(filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return `attachment; filename="${safe || "download"}"`;
}

/** Pull a semver-looking version out of a filename, if present. */
export function deriveVersion(name: string): string | null {
  const m = name.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1]! : null;
}

export type DesktopOs = "mac" | "win" | "linux";

const DESKTOP_EXTS: Record<string, DesktopOs> = {
  ".dmg": "mac",
  ".exe": "win",
  // Windows portable build (electron-builder `zip` target). This pipeline only
  // produces a .zip for Windows, so .zip => win is unambiguous today. CAVEAT:
  // electron-updater for macOS also uses a .zip; if a mac zip target is ever
  // added, this mapping must disambiguate by filename/arch instead of extension.
  ".zip": "win",
  ".appimage": "linux",
  ".deb": "linux",
};

function desktopOsForFile(name: string): DesktopOs | null {
  const lower = name.toLowerCase();
  for (const [ext, os] of Object.entries(DESKTOP_EXTS)) {
    if (lower.endsWith(ext)) return os;
  }
  return null;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

// ---- Shared latest-release fetch (cached per repo) ------------------------

type ReleaseAsset = { name: string; url: string; size: number };
type ReleaseManifest = { tagName: string | null; assets: ReleaseAsset[] };

const releaseCache = new Map<
  string,
  { at: number; value: ReleaseManifest | null }
>();
const TTL_OK = 5 * 60 * 1000;
const TTL_MISS = 60 * 1000;

/**
 * Fetch + cache a repo's latest release. Cached per repo so the apk and desktop
 * resolvers share one network call when they target the same repo (the default
 * case), while still supporting a distinct apk repo override. Returns null on
 * any failure (cached briefly so a down feed doesn't hammer GitHub).
 */
async function getLatestRelease(repo: string): Promise<ReleaseManifest | null> {
  const now = Date.now();
  const cached = releaseCache.get(repo);
  if (cached) {
    const ttl = cached.value ? TTL_OK : TTL_MISS;
    if (now - cached.at < ttl) return cached.value;
  }

  let value: ReleaseManifest | null = null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "engram-download",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (res.ok) {
      const json = (await res.json()) as {
        tag_name?: string;
        assets?: {
          name?: string;
          browser_download_url?: string;
          size?: number;
        }[];
      };
      value = {
        tagName: (json.tag_name ?? "").replace(/^v/, "") || null,
        assets: (json.assets ?? [])
          .filter((a) => a.name && a.browser_download_url)
          .map((a) => ({
            name: a.name!,
            url: a.browser_download_url!,
            size: a.size ?? 0,
          })),
      };
    }
  } catch {
    value = null;
  }

  releaseCache.set(repo, { at: now, value });
  return value;
}

// ---- Android APK ("do both": bundled wins, else latest release) ----------

export type ResolvedApk =
  | {
      kind: "bundled";
      filename: string;
      sizeBytes: number;
      localPath: string;
      version: string | null;
    }
  | {
      kind: "github";
      filename: string;
      sizeBytes: number;
      url: string;
      version: string | null;
    };

export function resolveBundledApk(): ResolvedApk | null {
  const explicit = process.env["ANDROID_APK_PATH"]?.trim();
  if (explicit) {
    try {
      const st = fs.statSync(explicit);
      if (st.isFile()) {
        const filename = path.basename(explicit);
        return {
          kind: "bundled",
          filename,
          sizeBytes: st.size,
          localPath: explicit,
          version: deriveVersion(filename),
        };
      }
    } catch {
      /* fall through to null */
    }
    return null;
  }

  const dir = downloadsDir();
  let best: { file: string; mtime: number; size: number } | null = null;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".apk")) continue;
      try {
        const st = fs.statSync(path.join(dir, f));
        if (st.isFile() && (!best || st.mtimeMs > best.mtime)) {
          best = { file: f, mtime: st.mtimeMs, size: st.size };
        }
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    return null;
  }
  if (!best) return null;
  return {
    kind: "bundled",
    filename: best.file,
    sizeBytes: best.size,
    localPath: path.join(dir, best.file),
    version: deriveVersion(best.file),
  };
}

export async function resolveApk(): Promise<ResolvedApk | null> {
  const bundled = resolveBundledApk();
  if (bundled) return bundled;
  const release = await getLatestRelease(apkRepo());
  const asset = release?.assets.find((a) =>
    a.name.toLowerCase().endsWith(".apk"),
  );
  if (!asset) return null;
  return {
    kind: "github",
    filename: asset.name,
    sizeBytes: asset.size,
    url: asset.url,
    version: release?.tagName ?? deriveVersion(asset.name),
  };
}

// ---- Desktop installers ("do both": bundled set wins, else release set) --

export type ResolvedDesktopFile = {
  os: DesktopOs;
  ext: string;
  filename: string;
  sizeBytes: number;
} & (
  | { source: "bundled"; localPath: string }
  | { source: "storage"; url: string }
  | { source: "github"; url: string }
);

export type DesktopResolution = {
  source: "bundled" | "storage" | "github" | null;
  version: string | null;
  installers: ResolvedDesktopFile[];
};

function resolveBundledDesktop(): ResolvedDesktopFile[] {
  const dir = downloadsDir();
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  // Keep the newest-by-mtime file per (os, ext) so e.g. an older + newer .dmg
  // don't both show; Linux still yields BOTH an .AppImage and a .deb.
  const bestByKey = new Map<
    string,
    { mtime: number; file: ResolvedDesktopFile }
  >();
  for (const f of entries) {
    const os = desktopOsForFile(f);
    if (!os) continue;
    const full = path.join(dir, f);
    let st: fs.Stats;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const ext = extOf(f);
    const key = `${os}:${ext}`;
    const prev = bestByKey.get(key);
    if (!prev || st.mtimeMs > prev.mtime) {
      bestByKey.set(key, {
        mtime: st.mtimeMs,
        file: {
          os,
          ext,
          filename: f,
          sizeBytes: st.size,
          source: "bundled",
          localPath: full,
        },
      });
    }
  }
  return [...bestByKey.values()].map((v) => v.file);
}

async function resolveReleaseDesktop(): Promise<{
  version: string | null;
  installers: ResolvedDesktopFile[];
}> {
  const release = await getLatestRelease(downloadsRepo());
  if (!release) return { version: null, installers: [] };
  const installers: ResolvedDesktopFile[] = [];
  for (const a of release.assets) {
    const os = desktopOsForFile(a.name);
    if (!os) continue;
    installers.push({
      os,
      ext: extOf(a.name),
      filename: a.name,
      sizeBytes: a.size,
      source: "github",
      url: a.url,
    });
  }
  return { version: release.tagName, installers };
}

export async function resolveDesktop(): Promise<DesktopResolution> {
  const bundled = resolveBundledDesktop();
  if (bundled.length > 0) {
    const version =
      bundled.map((b) => deriveVersion(b.filename)).find((v) => v) ?? null;
    return { source: "bundled", version, installers: bundled };
  }
  const stored = await resolveStoredDesktopDownload();
  if (stored) {
    const os = desktopOsForFile(stored.filename);
    if (os) {
      return {
        source: "storage",
        version: deriveVersion(stored.filename),
        installers: [
          {
            os,
            ext: extOf(stored.filename),
            filename: stored.filename,
            sizeBytes: stored.sizeBytes,
            source: "storage",
            url: stored.url,
          },
        ],
      };
    }
  }
  const release = await resolveReleaseDesktop();
  if (release.installers.length > 0) {
    return {
      source: "github",
      version: release.version,
      installers: release.installers,
    };
  }
  return { source: null, version: null, installers: [] };
}

/**
 * Resolve a single desktop installer by EXACT filename. Path-traversal safe:
 * the name must be a bare basename AND must exactly match one of the currently
 * resolved installer filenames (bundled scan or cached release manifest). The
 * returned localPath/url comes from the resolver, never from user input.
 */
export async function findDesktopInstaller(
  name: string,
): Promise<ResolvedDesktopFile | null> {
  if (!name || path.basename(name) !== name) return null;
  const { installers } = await resolveDesktop();
  return installers.find((i) => i.filename === name) ?? null;
}
