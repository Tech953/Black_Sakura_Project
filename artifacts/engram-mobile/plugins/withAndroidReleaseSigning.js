/**
 * Expo config plugin: wire a real release keystore into the generated
 * android/app/build.gradle, driven entirely by environment variables so the
 * keystore never touches git:
 *
 *   ANDROID_KEYSTORE_PATH      absolute path to the .keystore/.jks file
 *   ANDROID_KEYSTORE_PASSWORD  store password
 *   ANDROID_KEY_ALIAS          key alias
 *   ANDROID_KEY_PASSWORD       key password
 *
 * The injected Gradle reads the same variables AT BUILD TIME (System.getenv),
 * so the values are resolved when Gradle runs, not when prebuild runs. When
 * the variables are unset (or the file is missing) the release build type
 * falls back to the debug signing config — identical to the stock Expo
 * template — so unsigned/no-secret builds keep working.
 *
 * android/ is gitignored prebuild output; this plugin is what makes the
 * signing config survive `expo prebuild --clean` locally and in CI.
 */
const { withAppBuildGradle } = require("expo/config-plugins");

const SIGNING_CONFIG = `        release {
            def releaseStorePath = System.getenv("ANDROID_KEYSTORE_PATH")
            if (releaseStorePath != null && file(releaseStorePath).exists()) {
                storeFile file(releaseStorePath)
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            } else {
                // No release keystore configured: fall back to the debug key
                // so no-secret builds stay installable (not update-safe).
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // 1. Add a `release` entry inside signingConfigs { debug { ... } }
    if (!gradle.includes("ANDROID_KEYSTORE_PATH")) {
      gradle = gradle.replace(
        /(signingConfigs\s*\{\s*\n(?:.*\n)*?\s*debug\s*\{(?:.*\n)*?\s*\}\n)/,
        `$1${SIGNING_CONFIG}`
      );

      // 2. Point the release build type at it. signingConfigs.release itself
      // falls back to the debug key when no keystore env vars are set, so a
      // Groovy ternary here is unnecessary (and `signingConfig (cond) ? a : b`
      // actually parses as a method call on the boolean and crashes Gradle).
      gradle = gradle.replace(
        /(release\s*\{\s*\n(?:\s*\/\/.*\n)*)(\s*)signingConfig signingConfigs\.debug/,
        `$1$2signingConfig signingConfigs.release`
      );

      if (!gradle.includes("signingConfigs.release")) {
        throw new Error(
          "withAndroidReleaseSigning: failed to inject release signingConfig into app/build.gradle"
        );
      }
    }

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
