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
#   ENGRAM-<desktopVersion>-x64.zip   (slim Windows portable zip, < 300 MiB)
#   ENGRAM-android-<appVersion>.apk   (Gradle release APK, stable-key signed)
#   ENGRAM-android-previous-<priorVersion>.apk (lower-version update fixture)
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
KEYS_DIR="$REPO_ROOT/.keys"

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
  # The browser-downloadable Windows build intentionally omits the ~2.4 GB GGUF.
  # It remains offline-capable through Ollama, LM Studio, or another local
  # OpenAI-compatible server. Keep LLAMA_TARGET=win32 so every other native
  # resource (notably ffmpeg/ffprobe) is still staged for Windows.
  LLAMA_TARGET=win32 DESKTOP_BUNDLE_LLM=0 pnpm --filter @workspace/desktop run build
  [ ! -f "$DESKTOP_DIR/resources/llama/model.gguf" ] || {
    echo "ERROR: slim desktop build unexpectedly staged model.gguf" >&2
    exit 1
  }
  # zip-only: the NSIS .exe target needs wine and is CI-only.
  rm -f "$DESKTOP_DIR"/release/*.zip
  pnpm --filter @workspace/desktop exec electron-builder --win zip --publish never

  ZIP_SRC="$DESKTOP_DIR/release/ENGRAM-$DESKTOP_VERSION-x64.zip"
  if [ ! -f "$ZIP_SRC" ]; then
    # artifactName is ${productName}-${version}-${arch}.${ext}; fall back to
    # the newest zip in release/ in case the arch suffix differs.
    ZIP_SRC="$(ls -t "$DESKTOP_DIR"/release/*.zip 2>/dev/null | head -1 || true)"
  fi
  [ -n "$ZIP_SRC" ] && [ -f "$ZIP_SRC" ] || { echo "ERROR: no desktop zip produced in $DESKTOP_DIR/release" >&2; exit 1; }
  ZIP_BYTES="$(node -e 'process.stdout.write(String(require("fs").statSync(process.argv[1]).size))' "$ZIP_SRC")"
  MAX_ZIP_BYTES=$((300 * 1024 * 1024))
  if [ "$ZIP_BYTES" -ge "$MAX_ZIP_BYTES" ]; then
    echo "ERROR: desktop zip is $ZIP_BYTES bytes; slim release limit is $MAX_ZIP_BYTES bytes (300 MiB)." >&2
    exit 1
  fi

  find "$DOWNLOADS_DIR" -maxdepth 1 -name '*.zip' -delete
  cp "$ZIP_SRC" "$DOWNLOADS_DIR/$(basename "$ZIP_SRC")"
  echo "==> Desktop: refreshed $DOWNLOADS_DIR/$(basename "$ZIP_SRC") ($ZIP_BYTES bytes)"
fi

# ---------------------------------------------------------------- android ----
if [ "$DO_ANDROID" = 1 ]; then
  APP_VERSION="$(json_version "$MOBILE_DIR/app.json")"
  echo "==> Android: building release APK (v$APP_VERSION)"
  [ -d "$MOBILE_DIR/android" ] || { echo "ERROR: $MOBILE_DIR/android missing — run the prebuild steps in docs/building-the-android-apk.md first" >&2; exit 1; }
  [ -d "$SDK_DIR" ] || { echo "ERROR: Android SDK missing at $SDK_DIR — see docs/building-the-android-apk.md" >&2; exit 1; }

  # Prefer the workspace's ignored signing environment for local builds. CI
  # provides the same four variables directly through its secret store.
  if [ -z "${ANDROID_KEYSTORE_PATH:-}" ] && [ -f "$KEYS_DIR/android-signing.env" ]; then
    # shellcheck disable=SC1091
    . "$KEYS_DIR/android-signing.env"
  fi
  for signing_var in ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD; do
    if [ -z "${!signing_var:-}" ]; then
      echo "ERROR: $signing_var is required for an update-safe Android release." >&2
      echo "Source .keys/android-signing.env or configure the CI signing secrets." >&2
      exit 1
    fi
  done
  [ -f "$ANDROID_KEYSTORE_PATH" ] || { echo "ERROR: Android keystore not found at configured path." >&2; exit 1; }

  # The android/ project is NOT regenerated here (prebuild --clean would wipe
  # the Hermes/Babel fixes). Version fields accept explicit Gradle properties
  # so the predecessor can be built without mutating app.json or this project.
  if ! grep -q 'findProperty("engramVersionCode")' "$MOBILE_DIR/android/app/build.gradle" ||
    ! grep -q 'findProperty("engramVersionName")' "$MOBILE_DIR/android/app/build.gradle"; then
    echo "ERROR: Android build.gradle does not support controlled version overrides." >&2
    exit 1
  fi
  APP_VERSION_CODE="$(node -e 'const j = require(process.argv[1]); process.stdout.write(String(j.expo.android.versionCode));' "$MOBILE_DIR/app.json")"

  export ANDROID_HOME="$SDK_DIR"
  export ANDROID_SDK_ROOT="$SDK_DIR"
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=768}"
  GRADLE_JVMARGS="${ORG_GRADLE_JVMARGS:--Xmx1536m -XX:MaxMetaspaceSize=640m -Dfile.encoding=UTF-8}"
  pnpm --filter @workspace/engram-mobile run release:preflight

  BUILD_TOOLS_DIR="$(find "$SDK_DIR/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  APKSIGNER="$BUILD_TOOLS_DIR/apksigner"
  AAPT="$BUILD_TOOLS_DIR/aapt"
  [ -x "$APKSIGNER" ] || { echo "ERROR: apksigner not found in $BUILD_TOOLS_DIR" >&2; exit 1; }
  [ -x "$AAPT" ] || { echo "ERROR: aapt not found in $BUILD_TOOLS_DIR" >&2; exit 1; }

  APP_PACKAGE="$(node -e 'const j = require(process.argv[1]); process.stdout.write(String(j.expo.android.package));' "$MOBILE_DIR/app.json")"
  APP_VERSION_CODE="$(node -e 'const j = require(process.argv[1]); process.stdout.write(String(j.expo.android.versionCode));' "$MOBILE_DIR/app.json")"
  PREVIOUS_VERSION_CODE="$((APP_VERSION_CODE - 1))"
  [ "$PREVIOUS_VERSION_CODE" -gt 0 ] || {
    echo "ERROR: current Android versionCode must be greater than 1 to create an update fixture." >&2
    exit 1
  }
  PREVIOUS_VERSION="$(node -e '
    const version = String(process.argv[1]);
    const parts = version.split(".").map(Number);
    if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
      throw new Error(`Expected a three-part Android version, received ${version}`);
    }
    if (parts[2] > 0) parts[2] -= 1;
    else if (parts[1] > 0) { parts[1] -= 1; parts[2] = 99; }
    else if (parts[0] > 0) { parts[0] -= 1; parts[1] = 99; parts[2] = 99; }
    else throw new Error(`Cannot derive a predecessor for ${version}`);
    process.stdout.write(parts.join("."));
  ' "$APP_VERSION")"
  PREVIOUS_APK="$DOWNLOADS_DIR/ENGRAM-android-previous-$PREVIOUS_VERSION.apk"
  rm -f "$DOWNLOADS_DIR"/ENGRAM-android-previous-*.apk

  KEY_CERT="$(
    keytool -list -v \
      -keystore "$ANDROID_KEYSTORE_PATH" \
      -storepass "$ANDROID_KEYSTORE_PASSWORD" \
      -alias "$ANDROID_KEY_ALIAS" 2>/dev/null |
      awk -F': ' '/SHA256:/ {print $2; exit}' |
      tr -d ':' | tr 'A-F' 'a-f'
  )"
  [ -n "$KEY_CERT" ] || {
    echo "ERROR: could not read the configured Android release certificate." >&2
    exit 1
  }

  apk_cert() {
    "$APKSIGNER" verify --print-certs "$1" 2>/dev/null |
      awk -F': ' '/Signer #1 certificate SHA-256 digest:/ {print $2; exit}' |
      tr -d ':' | tr 'A-F' 'a-f'
  }

  assert_apk_metadata() {
    local apk="$1"
    local expected_code="$2"
    local expected_version="$3"
    local label="$4"
    local badging
    badging="$("$AAPT" dump badging "$apk")"
    if ! printf '%s\n' "$badging" | grep -q "package: name='$APP_PACKAGE' "; then
      echo "ERROR: $label package does not match $APP_PACKAGE." >&2
      exit 1
    fi
    local actual_code actual_version
    actual_code="$(printf '%s\n' "$badging" | sed -n "s/.*versionCode='\\([^']*\\)'.*/\\1/p" | sed -n '1p')"
    actual_version="$(printf '%s\n' "$badging" | sed -n "s/.*versionName='\\([^']*\\)'.*/\\1/p" | sed -n '1p')"
    if [ "$actual_code" != "$expected_code" ] || [ "$actual_version" != "$expected_version" ]; then
      echo "ERROR: $label metadata is version $actual_version (code $actual_code); expected $expected_version (code $expected_code)." >&2
      exit 1
    fi
  }

  # Build a lower-version release with the same source and release keystore.
  # Gradle properties override only the manifest version fields; app.json and
  # the checked-in current build remain unchanged.
  echo "==> Android: building previous signed update fixture (v$PREVIOUS_VERSION, code $PREVIOUS_VERSION_CODE)"
  (
    cd "$MOBILE_DIR/android"
    ./gradlew :app:assembleRelease \
      -PengramVersionCode="$PREVIOUS_VERSION_CODE" \
      -PengramVersionName="$PREVIOUS_VERSION" \
      -x lint --no-daemon --max-workers="${GRADLE_MAX_WORKERS:-1}" \
      -Dorg.gradle.jvmargs="$GRADLE_JVMARGS"
  )
  APK_SRC="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$APK_SRC" ] || { echo "ERROR: APK not found at $APK_SRC" >&2; exit 1; }
  assert_apk_metadata "$APK_SRC" "$PREVIOUS_VERSION_CODE" "$PREVIOUS_VERSION" "Previous APK"
  PREVIOUS_CERT="$(apk_cert "$APK_SRC")"
  if [ -z "$PREVIOUS_CERT" ] || [ "$PREVIOUS_CERT" != "$KEY_CERT" ]; then
    echo "ERROR: previous APK signer does not match the configured release keystore." >&2
    exit 1
  fi
  cp "$APK_SRC" "$PREVIOUS_APK"

  # Build the current release after the predecessor so the output path is
  # unambiguously the candidate that will be published.
  echo "==> Android: building release APK (v$APP_VERSION)"
  (
    cd "$MOBILE_DIR/android"
    ./gradlew :app:assembleRelease \
      -PengramVersionCode="$APP_VERSION_CODE" \
      -PengramVersionName="$APP_VERSION" \
      -x lint --no-daemon --max-workers="${GRADLE_MAX_WORKERS:-1}" \
      -Dorg.gradle.jvmargs="$GRADLE_JVMARGS"
  )
  APK_SRC="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
  [ -f "$APK_SRC" ] || { echo "ERROR: current APK not found at $APK_SRC" >&2; exit 1; }
  node "$MOBILE_DIR/scripts/release-preflight.mjs" --skip-expo --apk "$APK_SRC"
  assert_apk_metadata "$APK_SRC" "$APP_VERSION_CODE" "$APP_VERSION" "Current APK"

  APK_CERT="$(apk_cert "$APK_SRC")"
  if [ -z "$APK_CERT" ] || [ "$APK_CERT" != "$KEY_CERT" ]; then
    echo "ERROR: APK signer does not match the configured release keystore; refusing to stage it." >&2
    exit 1
  fi
  if [ "$PREVIOUS_CERT" != "$APK_CERT" ]; then
    echo "ERROR: predecessor and current APKs do not use the same release certificate." >&2
    exit 1
  fi
  if cmp -s "$PREVIOUS_APK" "$APK_SRC"; then
    echo "ERROR: predecessor APK is byte-identical to the current APK; update testing would be invalid." >&2
    exit 1
  fi

  rm -f "$DOWNLOADS_DIR/ENGRAM-android-$APP_VERSION.apk" "$DOWNLOADS_DIR/ENGRAM-android.apk"
  cp "$APK_SRC" "$DOWNLOADS_DIR/ENGRAM-android-$APP_VERSION.apk"
  cp "$APK_SRC" "$DOWNLOADS_DIR/ENGRAM-android.apk"
  ( cd "$DOWNLOADS_DIR" && sha256sum ENGRAM-android.apk > ENGRAM-android.apk.sha256 )
  echo "==> Android: refreshed $DOWNLOADS_DIR/ENGRAM-android-$APP_VERSION.apk, $PREVIOUS_APK, and $DOWNLOADS_DIR/ENGRAM-android.apk"
fi

echo "==> Done. downloads/ now contains:"
ls -lh "$DOWNLOADS_DIR" | grep -Ev '^total|README|\.gitkeep' || true
