---
name: Local Android APK build in the Replit workspace
description: How to build the Expo release APK locally (no CI), and the Babel/Hermes gotchas that block it.
---

## Setup
- Java: install `jdk17` via system deps. Android SDK lives at `.android-sdk/` in the repo root (gitignored): cmdline-tools latest, platform-tools, platforms;android-35, build-tools;35.0.0, licenses accepted. `android/local.properties` points `sdk.dir` there.
- Generate the android project with `npx expo prebuild --platform android --clean --no-install` in the mobile package.
- Background processes die between shell calls, so run Gradle in repeated foreground windows: `timeout 280 ./gradlew :app:assembleRelease -x lint --no-daemon` with `ANDROID_HOME` exported; Gradle's cache carries progress across runs. Expect ~3-4 windows on a warm cache.
- Output: `android/app/build/outputs/apk/release/app-release.apk` (debug-signed, sideloadable, not update-safe without a keystore).

## The Hermes/Babel trap (why a plain build fails)
The bundled `hermesc` (react-native sdks/hermesc) does NOT accept, by default:
- ES6 `class` declarations → "invalid statement encountered". Supported only behind `-Xes6-class`. **Fix:** `hermesFlags = ["-O", "-output-source-map", "-Xes6-class"]` in the `react {}` block of `android/app/build.gradle`. Do not repeat `-w` — gradle adds it and hermesc rejects duplicates.
- Private class fields/methods (`#x`) → transpile via Babel: `@babel/plugin-transform-class-properties`, `-private-methods`, `-private-property-in-object` in an `overrides` block of the mobile `babel.config.js`. Pin all three to `^7` — pnpm otherwise installs Babel 8 versions that drag `@babel/generator@8`/`traverse@8` into the Babel 7 pipeline and crash the worklets plugin.
- Async **arrow** functions (plain async functions are fine) → add `@babel/plugin-transform-arrow-functions` to the same overrides block.

Also:
- `react-native-worklets`' Babel plugin doesn't declare its `@babel/*` deps; under strict pnpm it fails with "Cannot find module '@babel/types'". **Fix:** `packageExtensions` in `pnpm-workspace.yaml` adding `@babel/types`, `@babel/generator`, `@babel/parser`, `@babel/traverse` to `react-native-worklets`.
- `babel-preset-expo` must be a devDep of the mobile package.
- Metro decides Hermes-targeting from the transform profile; keep `extraPackagerArgs = ["--unstable-transform-profile", "hermes-stable"]` in the react block (gradle passes it anyway, but the profile alone does NOT transpile classes/async-arrows — hence the flags/plugins above).
- Clear caches between transform-config changes: root `node_modules/.cache` and `/tmp/metro-*`, or hermesc keeps compiling a stale bundle.

## Expo package version mismatch (boot-crash trap)
A boot crash `NoSuchMethodError ... expo.modules.kotlin.types.ReturnTypeKt.getDirectConverter` means an expo-* package's native Kotlin was built against a different expo-modules-core than the SDK ships (e.g. expo-file-system/expo-sqlite from a newer SDK in an SDK 54 app). Run `npx expo install --check` and pin the expected versions before every release build. A release-build crash screen (UncaughtExceptionHandler in MainApplication.attachBaseContext → CrashActivity in its own :crash process) is now baked into the app and was essential for diagnosing on log-less devices.

## llama.rn native libs (boot-crash trap)
llama.rn ships NO Android .so in the npm tarball — a postinstall script (`install/download-native-artifacts.js`) downloads prebuilt jniLibs, and **pnpm blocks that postinstall by default**. Result: the APK builds fine but has zero librnllama*.so, while RNLlamaPackage is still autolinked into PackageList → instant native crash at app launch (before any JS). **Fix:** run `node ./install/download-native-artifacts.js` inside node_modules/llama.rn before assembling, then verify with `unzip -l app-release.apk | grep librnllama`. The prebuilt libs are 64-bit only (arm64-v8a, x86_64) — set `reactNativeArchitectures=arm64-v8a,x86_64` in android/gradle.properties or the 32-bit ABI splits crash the same way. Re-download after any pnpm install that recreates node_modules.

## Windows
NSIS `.exe` needs wine → CI-only. Local Windows deliverable is the electron-builder portable zip target (`--win --publish never`), ~200MB.

## Delivery
The api-server Download endpoints serve committed files in `downloads/` first (`.zip`→win, `.apk`→android). One-command refresh exists; any installer-refresh flow must reuse the prebuilt android/ project (re-running prebuild wipes the Hermes/Babel fixes above) and must stage LLAMA_TARGET=win32 llama binaries when cross-packaging the Windows zip from Linux. Beware: a multi-GB zip in `downloads/` will bloat any future git push.

## Modern Android device QA
- Increment `android.versionCode` for each downloadable APK so an existing install can upgrade instead of being rejected as an equal/older package.
- For Android 15/16-era devices, validate both APK ZIP alignment with `zipalign -c -P 16 -v 4` and every arm64 ELF `LOAD` segment alignment (`0x4000`); uncompressed native libraries must be 16 KB compatible.
- Keep `android.resizeableActivity` enabled for foldables so folding/unfolding and multi-window configuration changes remain supported.
