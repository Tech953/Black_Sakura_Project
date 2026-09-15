# ENGRAM 1.0.2 Android device QA

Date: 2026-09-15

## Artifact checked

- File: `downloads/ENGRAM-android.apk`
- Size: 180,317,549 bytes
- SHA-256: `cf679540a16679570490ea882905ea900aa714dc4a5ed81f7c505644ccdf228d`
- Checksum file: `downloads/ENGRAM-android.apk.sha256`
- Checksum result: passed
- File inspection: recognized as an Android package
- Expected app inputs from `artifacts/engram-mobile/app.json`: package `ai.pyri.engram`, version `1.0.2`, version code `4`
- Release signer continuity: passed against the configured release keystore and the previous downloadable APK

## Rebuild and release preflight

The stale APK was rebuilt from the current `artifacts/engram-mobile` Android project and staged as both
`downloads/ENGRAM-android.apk` and `downloads/ENGRAM-android-1.0.2.apk`.

The rebuilt APK passed:

- package, version name/code, and current Android build-input freshness
- `android:allowBackup="false"` and explicit backup exclusion resources
- required permission policy with no forbidden storage, location, microphone, or overlay permissions
- exactly the `arm64-v8a` and `x86_64` ABI set
- `librnllama` presence for both release ABIs
- Android 16 KB ZIP alignment (`zipalign -P 16`)
- 16 KB arm64 ELF `LOAD` alignment (32 libraries checked)
- native chat export regression (9 tests) and web export compatibility regression (4 tests)

The authenticated history browser regression initially timed out during the first release script run,
before Gradle packaging. A retry passed the hydrate, archive, restore, read-only state, and four export
download checks. The APK-specific preflight was then run with the already-passed history check excluded
to avoid duplicating it.

## Release-blocking artifact finding

The previous downloadable APK was not accepted as a current release candidate. Its APK preflight
failed with:

```text
Release APK includes forbidden permission android.permission.READ_EXTERNAL_STORAGE.
```

The rebuilt artifact no longer contains that permission and passed the complete APK preflight above.

The old generic `unzip -tq` inspection also reported invalid extra-field warnings on native library
entries. The rebuilt artifact passed the Android release tools' ZIP alignment verification.

## Galaxy Z Flip 8 results

Not executed in this workspace:

- No `adb` binary or connected Android device/emulator is available.
- The Galaxy Z Flip 8 Android version and One UI version could not be recorded.
- The APK was not installed on a phone.
- Launch, fold/unfold, cold relaunch, online chat, offline mode, language switching, and inquiry were not exercised.
- No device crash screen or native `adb logcat` trace is available.

The native launch-reliability plugin is present in the checked-in app configuration. It installs a startup uncaught-exception handler and a separate `CrashActivity` that displays a selectable trace for screenshot capture, but that behavior still requires a real Android launch test.

## Release-pass rerun in this workspace

Date: 2026-09-15

- Verified both staged APK paths contain the same rebuilt artifact.
- Verified SHA-256: `cf679540a16679570490ea882905ea900aa714dc4a5ed81f7c505644ccdf228d`.
- `adb` is not installed, so no Android or One UI version can be read and no phone installation or runtime smoke test can be performed.
- The full release preflight was attempted. Its authenticated history browser step timed out while waiting for the signed-in ENGRAM card; this is a local Chromium/web-check failure and does not provide Galaxy device evidence.
- The remaining release preflight was rerun with only that already-failing history step excluded and passed:
  - Expo package compatibility
  - native export regression: 9 tests
  - font budget
  - web export compatibility: 4 tests
  - checked-in Android privacy/backup policy
  - llama native libraries for `arm64-v8a` and `x86_64`
  - APK package/version/privacy freshness
  - APK privacy/permission policy
  - APK ABI and `librnllama` contents
  - 16 KB ZIP alignment
  - 16 KB arm64 ELF alignment: 32 libraries

These checks confirm the rebuilt artifact is ready for a real-device pass, but they do not replace the required Galaxy Z Flip 8 launch, fold/unfold, cold-relaunch, online chat, offline mode, language, and inquiry checks.

## Required release-device pass after rebuilding

On the Galaxy Z Flip 8, record the exact Android and One UI versions, then:

1. Install the rebuilt `ENGRAM-android.apk` and launch it before testing secondary flows.
2. Confirm it remains open through one fold and unfold.
3. Cold relaunch and confirm it remains open.
4. Smoke-test online chat, offline mode, language switching, and inquiry in that order.
5. If launch fails, capture the full ENGRAM diagnostic screen or `adb logcat` native trace and attach it to the release QA record.