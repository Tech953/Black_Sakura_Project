# ENGRAM 1.0.2 Android device QA

Date: 2026-09-12

## Artifact checked

- File: `downloads/ENGRAM-android.apk`
- Size: 179,456,136 bytes
- SHA-256: `c903ade4fe20aef72ae689783108469cc713ba85b176af81fc5aea0b50d437bb`
- Checksum file: `downloads/ENGRAM-android.apk.sha256`
- Checksum result: passed
- File inspection: recognized as an Android package
- Expected app inputs from `artifacts/engram-mobile/app.json`: package `ai.pyri.engram`, version `1.0.2`, version code `4`

## Release-blocking artifact finding

The downloaded APK was not accepted as a current release candidate. Running the APK preflight reached privacy verification and failed with:

```text
Release APK includes forbidden permission android.permission.READ_EXTERNAL_STORAGE.
```

The checked-in Android privacy plugin removes this permission, and the checked-in manifest/preflight policy rejects it. This indicates that the downloaded APK predates the current privacy-hardening build or was produced from a different Android source state. The artifact must be rebuilt and re-verified before device installation is treated as release QA.

The generic `unzip -tq` inspection also reported invalid extra-field warnings on native library entries. The APK checksum is valid and the archive is recognized as an Android package, but this warning should be rechecked on the rebuilt artifact with the Android release tools.

## Galaxy Z Flip 8 results

Not executed in this workspace:

- No `adb` binary or connected Android device/emulator is available.
- The Galaxy Z Flip 8 Android version and One UI version could not be recorded.
- The APK was not installed on a phone.
- Launch, fold/unfold, cold relaunch, online chat, offline mode, language switching, and inquiry were not exercised.
- No device crash screen or native `adb logcat` trace is available.

The native launch-reliability plugin is present in the checked-in app configuration. It installs a startup uncaught-exception handler and a separate `CrashActivity` that displays a selectable trace for screenshot capture, but that behavior still requires a real Android launch test.

## Required release-device pass after rebuilding

On the Galaxy Z Flip 8, record the exact Android and One UI versions, then:

1. Install the rebuilt `ENGRAM-android.apk` and launch it before testing secondary flows.
2. Confirm it remains open through one fold and unfold.
3. Cold relaunch and confirm it remains open.
4. Smoke-test online chat, offline mode, language switching, and inquiry in that order.
5. If launch fails, capture the full ENGRAM diagnostic screen or `adb logcat` native trace and attach it to the release QA record.