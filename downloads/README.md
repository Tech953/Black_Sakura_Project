# Bundled downloads

Drop a built installer in this folder to have the deployed app serve it directly
(same-origin) from the **Download** page (`/download`) and the API — the browser
never calls GitHub. Two kinds of files are recognized:

- **Desktop installers** — `.dmg` (macOS), `.exe` installer or portable `.zip` (Windows), `.AppImage` / `.deb` (Linux)
- **Android** — a single `.apk`

Endpoints (`artifacts/api-server/src/routes/download.ts`, logic in
`lib/downloads.ts`):

- `GET /api/download/desktop` — JSON metadata (`available`, `source`, `version`, `installers[]`)
- `GET /api/download/desktop/file/:name` — a specific installer binary
- `GET /api/download/android` — JSON metadata (`available`, `source`, `version`, `filename`, `sizeBytes`)
- `GET /api/download/android.apk` — the APK itself

## How serving works ("do both")

Both desktop and Android resolve in the same two-step order:

1. **Bundled** — the newest matching file committed in this directory. For
   desktop, the newest file **per `(os, extension)`** is chosen, so Linux serves
   BOTH the `.AppImage` and the `.deb`. (The APK also honors a single
   `ANDROID_APK_PATH`; the directory is overridable with `ANDROID_APK_DIR`.)
2. **GitHub fallback** — if nothing is bundled, the API fetches the latest
   release and proxy-streams the matching asset(s), so the download still stays
   on this app's origin. Desktop uses `DOWNLOADS_GITHUB_REPO` (default
   `Tech953/Ch-IO`); the APK uses `ANDROID_APK_GITHUB_REPO` (which falls back to
   `DOWNLOADS_GITHUB_REPO`).

Desktop bundling is **all-or-nothing for version coherence**: if ANY bundled
desktop installer is present, the bundled set wins entirely and the GitHub
fallback is not consulted for desktop. The APK is resolved independently.

If neither a bundled file nor a release asset is available, the Download page
shows an honest empty state instead of a dead button.

## Shipping a bundled file to your deploy

The Replit deployment builds from the **committed git state**, so to bundle a
file you must **commit it here** (these files are not gitignored). Installers are
large (an APK is ~30–100 MB; desktop installers are bigger), which permanently
increases repo size — if you'd rather not commit a large binary, rely on the
GitHub release fallback above (no commit needed).

## Refreshing after a rebuild

Run **`pnpm run build:installers`** (or `./scripts/build-installers.sh`) from
the repo root to rebuild both the Windows portable zip and the Android APK and
refresh this folder in one step (`--desktop` / `--android` build just one).
Filenames carry the current app versions, which is what the Download page
displays — so rerun this after bumping a version or changing app code.

## Building the installers

You cannot build desktop installers or an Android APK inside Replit/Deploy
(electron-builder needs each target OS; there's no Android SDK). Build them on
the matching OS / in CI:

- Android `.apk` — see [`docs/building-the-android-apk.md`](../docs/building-the-android-apk.md).
- Desktop installers — see the desktop build commands in the root `replit.md`
  ("Run & Operate"), or let `.github/workflows/desktop-build.yml` publish a
  release that the GitHub fallback will serve automatically.
