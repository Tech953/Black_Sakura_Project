#!/usr/bin/env bash
# Rebuild the in-app installers and refresh downloads/ so the Download page
# always serves binaries that match the current code.
#
# Usage:
#   ./scripts/build-installers.sh              # desktop zip + Android APK
#   ./scripts/build-installers.sh --desktop    # only the Windows portable zip
#   ./scripts/build-installers.sh --android    # only the Android APK
#
# What it produces in downloads/ (older siblings of the same kind are removed):
#   ENGRAM-<desktopVersion>-x64.zip   (electron-builder Windows portable zip)
#   ENGRAM-android-<appVersion>.apk   (Gradle release APK, debug-signed)
#
# Notes:
# - The Windows portable ZIP is the only desktop target buildable on Linux
#   without wine; .exe/.dmg come from CI (.github/workflows/desktop-build.yml).
# - The Android build reuses the already-prebuilt android/ project (it carries
#   required Hermes/Babel fixes — see docs/building-the-android-apk.md). It is
#   NOT regenerated here; if android/ is missing, follow that doc first.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DOWNLOADS_DIR="$REPO_ROOT/downloads"
MOBILE_DIR="$REPO_ROOT/artifacts/engram-mobile"
DESKTOP_DIR="$REPO_ROOT/artifacts/desktop"
SDK_DIR="$REPO_ROOT/.android-sdk"

DO_DESKTOP=1
DO_ANDROID=1
case "${1:-}" in
  --desktop) DO_ANDROID=0 ;;
  --android) DO_DESKTOP=0 ;;
  "") ;;
  *) echo "Unknown flag: $1 (use --desktop or --android)" >&2; exit 2 ;;
esac

mkdir -p "$DOWNLOADS_DIR"

json_version() { # json_version <file> — read top-level or expo version
  node -e '
    const j = require(process.argv[1]);
    process.stdout.write(j.version ?? j.expo?.version ?? "");
  ' "$1"
}

# Keep a native offline regression from being packaged into a downloadable APK.
# Run this before either installer build so a failure stops release work early.
if [ "$DO_ANDROID" = 1 ]; then
  echo "==> Android: running mobile offline reliability checks"
  pnpm run test:mobile-offline
fi

# ---------------------------------------------------------------- desktop ----
if [ "$DO_DESKTOP" = 1 ]; then
  DESKTOP_VERSION="$(json_version "$DESKTOP_DIR/package.json")"
  echo "==> Desktop: building Windows portable zip (v$DESKTOP_VERSION)"
  # Cross-packaging from Linux: stage the WINDOWS llama.cpp binaries (exe/dlls),
  # not the host's — otherwise the bundled offline LLM can't run on Windows.
  LLAMA_TARGET=win32 pnpm --filter @workspace/desktop run build
  # zip-only: the NSIS .exe target needs wine and is CI-only.
  pnpm --filter @workspace/desktop exec electron-builder --win zip --publish never

  ZIP_SRC="$DESKTOP_DIR/release/ENGRAM-$DESKTOP_VERSION-x64.zip"
  if [ ! -f "$ZIP_SRC" ]; then
    # artifactName is ${productName}-${version}-${arch}.${ext}; fall back to
    # the newest zip in release/ in case the arch suffix differs.
    ZIP_SRC="$(ls -t "$DESKTOP_DIR"/release/*.zip 2>/dev/null | head -1 || true)"
  fi
  [ -n "$ZIP_SRC" ] && [ -f "$ZIP_SRC" ] || { echo "ERROR: no desktop zip produced in $DESKTOP_DIR/release" >&2; exit 1; }

  find "$DOWNLOADS_DIR" -maxdepth 1 -name '*.zip' -delete
  cp "$ZIP_SRC" "$DOWNLOADS_DIR/$(basename "$ZIP_SRC")"
  echo "==> Desktop: refreshed $DOWNLOADS_DIR/$(basename "$ZIP_SRC")"
fi

# ---------------------------------------------------------------- android ----
if [ "$DO_ANDROID" = 1 ]; then
  APP_VERSION="$(json_version "$MOBILE_DIR/app.json")"
  echo "==> Android: building release APK (v$APP_VERSION)"
  [ -d "$MOBILE_DIR/android" ] || { echo "ERROR: $MOBILE_DIR/android missing — run the prebuild steps in docs/building-the-android-apk.md first" >&2; exit 1; }
  [ -d "$SDK_DIR" ] || { echo "ERROR: Android SDK missing at $SDK_DIR — see docs/building-the-android-apk.md" >&2; exit 1; }

  # The android/ project is NOT regenerated here (prebuild --clean would wipe
  # the Hermes/Babel fixes), so guard against a stale native versionName: the
  # APK we publish must actually carry the version its filename claims.
  GRADLE_VERSION="$(grep -oP 'versionName\s+"\K[^"]+' "$MOBILE_DIR/android/app/build.gradle" | head -1 || true)"
  if [ "$GRADLE_VERSION" != "$APP_VERSION" ]; then
    echo "ERROR: app.json version ($APP_VERSION) != android/app/build.gradle versionName ($GRADLE_VERSION)." >&2
    echo "Update versionName (and versionCode) in $MOBILE_DIR/android/app/build.gradle to match app.json," >&2
    echo "or re-run prebuild per docs/building-the-android-apk.md (then re-apply its Hermes/Babel fixes)." >&2
    exit 1
  fi

  export ANDROID_HOME="$SDK_DIR"
  export ANDROID_SDK_ROOT="$SDK_DIR"
  ( cd "$MOBILE_DIR/android" && ./gradlew :app:assembleRelease -x lint --no-daemon )

  APK_SRC="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$APK_SRC" ] || { echo "ERROR: APK not found at $APK_SRC" >&2; exit 1; }

  find "$DOWNLOADS_DIR" -maxdepth 1 -name '*.apk' -delete
  cp "$APK_SRC" "$DOWNLOADS_DIR/ENGRAM-android-$APP_VERSION.apk"
  echo "==> Android: refreshed $DOWNLOADS_DIR/ENGRAM-android-$APP_VERSION.apk"
fi

echo "==> Done. downloads/ now contains:"
ls -lh "$DOWNLOADS_DIR" | grep -Ev '^total|README|\.gitkeep' || true
