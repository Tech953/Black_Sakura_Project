# Building the ENGRAM Android `.apk`

This guide explains how to produce the installable Android package (`.apk`) for
the ENGRAM mobile app (`@workspace/engram-mobile`, an Expo / React Native app),
and how to make it downloadable from the deployed web app.

> **Why you can't build it on Replit / inside Deploy**
> An Android build needs the Android SDK, a JDK, and Gradle (plus, for a release
> build, hundreds of MB of tooling). The Replit deploy environment has none of
> these, and a Gradle build is far too heavy for the deploy step. So the `.apk`
> is always built **elsewhere** (CI or your own machine) and then served by the
> deployed app — see [Make it downloadable](#make-it-downloadable-through-deploy).

---

## Option A — Let CI build it (recommended, no local setup)

The repo already builds the APK in GitHub Actions:
`.github/workflows/desktop-build.yml` (the **`android`** job).

1. Bump the version and push a tag:
   ```bash
   git tag v1.2.3
   git push origin v1.2.3
   ```
2. CI runs `expo prebuild` + Gradle `assembleRelease`, then attaches
   `ENGRAM-Mobile-<version>.apk` to the **same GitHub Release** as the desktop
   installers.
3. The deployed app's Download page picks it up automatically through the GitHub
   fallback (no further action needed).

**Signing:** CI signs the APK with the private ENGRAM release keystore when
these four repository secrets are set (GitHub → Settings → Secrets and
variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 .keys/engram-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | store password from `.keys/android-signing.env` |
| `ANDROID_KEY_ALIAS` | key alias from `.keys/android-signing.env` |
| `ANDROID_KEY_PASSWORD` | key password from `.keys/android-signing.env` |

The keystore and its credentials live in the (gitignored) `.keys/` directory of
the Replit workspace. The workflow verifies the built APK's signer certificate
against the pinned release-key fingerprint and **fails the build** if the
keystore is wrong or missing, so a debug-signed APK can never silently ship.

---

## Option B — Build it locally

### Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24.x | Matches the repo's `nodejs-24` module |
| pnpm | 9+ | Workspace package manager |
| JDK | 17 | Required by the Android Gradle Plugin |
| Android SDK | Platform 34 + build-tools | Easiest via **Android Studio** |
| Android NDK | As pinned by Expo | Installed via the SDK Manager |

Set the standard Android env vars so Gradle can find the SDK:

```bash
export ANDROID_HOME="$HOME/Android/Sdk"   # or your SDK path
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

### Steps

From the repo root:

```bash
# 1. Install workspace dependencies
pnpm install

# 2. Generate the native Android project from the Expo config.
#    --clean ensures a fresh android/ folder; --no-install skips a redundant
#    dependency install we already did above.
pnpm --filter @workspace/engram-mobile exec expo prebuild \
  --platform android --no-install --clean

# 3. Build the release APK with Gradle
cd artifacts/engram-mobile/android
./gradlew :app:assembleRelease
```

The signed (debug key by default) APK lands at:

```
artifacts/engram-mobile/android/app/build/outputs/apk/release/app-release.apk
```

### Install it on a device

- **Via USB (adb):**
  ```bash
  adb install -r app-release.apk
  ```
- **Via sideload:** copy the `.apk` to the phone and open it; enable
  "Install unknown apps" for your file manager/browser when prompted
  (Android 8+).

### Versioning

`app.json` carries `expo.version` (the user-visible version, e.g. `1.2.3`) and
`android.versionCode` (an integer that **must increase** for every release the
Play Store / in-place update accepts). In CI, the user-visible version comes
from the git tag and the version code is set to a value greater than the
checked-in code and the workflow run number. For local builds, bump them by
hand in `app.json` before prebuilding if you want an update-safe sequence.
Keep the matching `versionCode` in `android/app/build.gradle`; the installer
script refuses to package a mismatch.

### Release signing (update-safe installs)

Release signing is already wired in: an Expo config plugin
(`artifacts/engram-mobile/plugins/withAndroidReleaseSigning.js`, registered in
`app.json`) injects a `release` signing config into the generated
`android/app/build.gradle` on every `expo prebuild`, so it survives `--clean`
regeneration locally and in CI. Gradle reads these environment variables **at
build time**:

| Variable | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | Absolute path to the `.keystore` file |
| `ANDROID_KEYSTORE_PASSWORD` | Store password |
| `ANDROID_KEY_ALIAS` | Key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

In the Replit workspace, the private keystore and its credentials live in the
gitignored `.keys/` directory. To build a release-signed APK locally:

```bash
source .keys/android-signing.env   # exports the four variables above
cd artifacts/engram-mobile/android
./gradlew :app:assembleRelease
```

The direct Gradle command still has a debug fallback for development-only
builds, but `scripts/build-installers.sh` and CI require the release keystore
and verify that the APK signer matches it before staging a downloadable APK.

Keep the keystore safe and **never commit it** — losing it means you can no
longer ship updates that install over existing copies.

---

## Make it downloadable through Deploy

The deployed app serves the APK **same-origin** so visitors download it straight
from your site (no GitHub redirect). It resolves the file in two stages — "do
both":

1. **Bundled** — if you committed a `.apk` into the [`downloads/`](../downloads)
   directory (or pointed `ANDROID_APK_PATH` at one), that file is served.
2. **GitHub fallback** — otherwise the latest release of
   `ANDROID_APK_GITHUB_REPO` (default `Tech953/Ch-IO`) is fetched and
   proxy-streamed.

Endpoints (API server, `artifacts/api-server/src/routes/download.ts`):

- `GET /api/download/android` — JSON: `{ available, source, version, filename, sizeBytes }`
- `GET /api/download/android.apk` — the binary download

### To bundle your own APK

1. Build it (Option A or B above).
2. Copy it into `downloads/` and **commit it** (the deploy builds from the
   committed git state):
   ```bash
   cp app-release.apk downloads/ENGRAM-Mobile-1.2.3.apk
   git add downloads/ENGRAM-Mobile-1.2.3.apk
   git commit -m "Bundle Android v1.2.3 for download"
   ```
3. Re-deploy. The Download page now serves your bundled APK.

> An APK is large (30–100 MB). Committing it permanently grows the repo. If you
> would rather not commit a binary, skip bundling and rely on the GitHub release
> fallback (Option A).

### Relevant environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANDROID_APK_PATH` | _(unset)_ | Absolute path to a single bundled `.apk` |
| `ANDROID_APK_DIR` | `<repo>/downloads` | Directory scanned for the newest `*.apk` |
| `ANDROID_APK_GITHUB_REPO` | `Tech953/Ch-IO` | `owner/repo` for the GitHub fallback |
| `VITE_GITHUB_REPO` | `Tech953/Ch-IO` | Web build-time repo for the **desktop** release feed |
