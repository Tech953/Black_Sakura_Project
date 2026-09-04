---
name: Android APK CI release
description: How the ENGRAM Android .apk is built in CI without an Expo account and attached to electron-builder's draft GitHub release, plus signing and OS-detection gotchas.
---

# Android APK build + release (ENGRAM)

The Download page no longer calls GitHub from the browser — both desktop installers
and the `.apk` are served **same-origin** by the app's API (`/api/download/*`, pure
logic in `lib/downloads.ts`), which resolves a committed `downloads/` file first and
otherwise proxy-streams the latest GitHub release asset (matched to an OS by file
extension). The Android `.apk` still rides the SAME release as the desktop installers,
built by an `android` job in the desktop CI workflow. The CI mechanics below are
unchanged regardless of how the page fetches.

## Attaching a non-electron-builder asset to electron-builder's draft release
- electron-builder publishes desktop installers to a **draft** release whose
  `tag_name` is set but is **not yet a real git tag**.
- **Why it matters:** `gh release upload <tag> ...` and the `repos/.../releases/tags/<tag>`
  API only resolve **published** releases, so they cannot see/target the draft.
- **How to apply:** resolve the draft by **name** (the tag string) to get its release
  **id** (same jq filter the `publish` un-draft job uses), then upload via
  `https://uploads.github.com/repos/<repo>/releases/<id>/assets?name=<file>` (curl or
  the uploads host — NOT plain `gh api`, which targets api.github.com). Make it
  idempotent by deleting any same-named asset first. Order the job `needs: build`
  (so the draft exists) and make the `publish` job `needs: [build, android]`.

## Release keystore signing (current setup)
- A private release keystore lives at `.keys/engram-release.keystore` (gitignored;
  creds in `.keys/android-signing.env`). Gradle reads `ANDROID_KEYSTORE_PATH/…PASSWORD/
  …ALIAS/…KEY_PASSWORD` **at build time** via an Expo config plugin
  (`plugins/withAndroidReleaseSigning.js`, registered in app.json) so the signing
  config survives `expo prebuild --clean`. With the env unset, `signingConfigs.release`
  falls back to the debug key (sideloadable, not update-safe).
- **Groovy trap:** `signingConfig (cond) ? a : b` parses as a method call on the
  boolean and crashes AGP ("Boolean cannot be cast to SigningConfig"). Put the
  fallback inside the signingConfig block instead of a ternary at the buildType.
- CI (android job) requires all four `ANDROID_KEYSTORE_*` Actions secrets, decodes
  and opens the keystore, then pins the APK certificate fingerprint. It fails
  rather than silently shipping a debug-signed or rotated-key APK.
- The local installer script sources `.keys/android-signing.env`, requires the
  keystore, checks the APK certificate against that keystore, and checks that the
  APK `versionCode` matches `app.json`. **Never lose or commit the keystore** —
  losing it permanently breaks in-place updates for existing installs.

### Memory-constrained release builds
- **Why:** an unrestricted Gradle release build can have its daemon killed while
  Metro and native CMake compilation run concurrently in the workspace.
- **How to apply:** local installer builds use `--max-workers=2`, a 1536 MB Gradle
  heap, reduced metaspace, and a 768 MB Node heap; retrying without these limits
  is likely to fail before packaging.

## OS/device detection ordering
- An Android browser User-Agent string also contains the substring `linux`.
- **How to apply:** in any UA-based OS detection, check `android` **before** `linux`,
  or Android devices get misclassified as Linux.

## Build env notes
- JDK 17 for RN 0.81 / AGP 8.x. `prebuild --no-install` is correct after a root
  `pnpm install`; invoke the Expo CLI from the mobile package so pnpm autolinking
  resolves. Build shared libs (codegen + `typecheck:libs`) before Gradle so Metro can
  bundle the workspace-lib imports for the release APK. `android/` is gitignored
  (prebuild output) so CI must regenerate it (`--clean`).
