/**
 * Keep ENGRAM's Android launch safeguards reproducible across Expo's
 * `prebuild --clean`. The generated android/ directory is gitignored, so these
 * settings must live in a config plugin rather than hand-edited native files.
 */
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withGradleProperties,
  withMainApplication,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const MAIN_APPLICATION_IMPORTS = `import android.content.Context
import android.content.Intent
import java.io.PrintWriter
import java.io.StringWriter
`;

const CRASH_HANDLER = `  override fun attachBaseContext(base: Context) {
    super.attachBaseContext(base)
    // Surface startup crashes on-screen when logcat is unavailable.
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        val sw = StringWriter()
        throwable.printStackTrace(PrintWriter(sw))
        val trace = sw.toString().take(12000)
        val intent = Intent(this, CrashActivity::class.java).apply {
          putExtra(CrashActivity.EXTRA_TRACE, trace)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        startActivity(intent)
      } catch (_: Throwable) {
        previous?.uncaughtException(thread, throwable)
      }
      android.os.Process.killProcess(android.os.Process.myPid())
      System.exit(10)
    }
  }

`;

function withSupportedArchitectures(config) {
  return withGradleProperties(config, (cfg) => {
    const properties = {
      reactNativeArchitectures: "arm64-v8a,x86_64",
      "org.gradle.jvmargs": "-Xmx2048m -XX:MaxMetaspaceSize=640m",
    };
    for (const [key, value] of Object.entries(properties)) {
      const existing = cfg.modResults.find(
        (entry) => entry.type === "property" && entry.key === key,
      );
      if (existing) {
        existing.value = value;
      } else {
        cfg.modResults.push({ type: "property", key, value });
      }
    }
    return cfg;
  });
}

function withHermesCompatibility(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (!gradle.includes('hermesFlags = ["-O", "-output-source-map", "-Xes6-class"]')) {
      const marker = '    bundleCommand = "export:embed"\n';
      if (!gradle.includes(marker)) {
        throw new Error(
          "withAndroidLaunchReliability: could not find Expo bundleCommand in app/build.gradle",
        );
      }
      gradle = gradle.replace(
        marker,
        `${marker}    extraPackagerArgs = ["--unstable-transform-profile", "hermes-stable"]\n` +
          `    hermesFlags = ["-O", "-output-source-map", "-Xes6-class"]\n`,
      );
    }
    cfg.modResults.contents = gradle;
    return cfg;
  });
}

function withStartupCrashHandler(config) {
  config = withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== "kt") {
      throw new Error(
        "withAndroidLaunchReliability: expected a Kotlin MainApplication",
      );
    }
    let source = cfg.modResults.contents;
    if (!source.includes("import android.content.Context")) {
      const marker = "import android.app.Application\n";
      if (!source.includes(marker)) {
        throw new Error(
          "withAndroidLaunchReliability: could not find MainApplication import marker",
        );
      }
      source = source.replace(marker, `${marker}${MAIN_APPLICATION_IMPORTS}`);
    }
    if (!source.includes("override fun attachBaseContext")) {
      const marker = "  override fun onCreate()";
      if (!source.includes(marker)) {
        throw new Error(
          "withAndroidLaunchReliability: could not find MainApplication.onCreate",
        );
      }
      source = source.replace(marker, `${CRASH_HANDLER}${marker}`);
    }
    cfg.modResults.contents = source;
    return cfg;
  });

  config = withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error(
        "withAndroidLaunchReliability: AndroidManifest has no application",
      );
    }
    application.activity = application.activity ?? [];
    if (
      !application.activity.some(
        (activity) => activity.$?.["android:name"] === ".CrashActivity",
      )
    ) {
      application.activity.push({
        $: {
          "android:name": ".CrashActivity",
          "android:process": ":crash",
          "android:exported": "false",
          "android:theme": "@android:style/Theme.Black.NoTitleBar",
        },
      });
    }
    return cfg;
  });

  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const packageName = cfg.android?.package;
      if (!packageName) {
        throw new Error(
          "withAndroidLaunchReliability: expo.android.package is required",
        );
      }
      const packageDir = packageName.replace(/\./g, path.sep);
      const destination = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/java",
        packageDir,
        "CrashActivity.kt",
      );
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(
        destination,
        `package ${packageName}

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

/**
 * Runs in its own process after an uncaught startup exception so a user can
 * capture the native trace even when the main React Native process terminates.
 */
class CrashActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val trace = intent.getStringExtra(EXTRA_TRACE) ?: "No stack trace captured."
    val text = TextView(this).apply {
      setTextIsSelectable(true)
      setTextColor(Color.parseColor("#E8F0E8"))
      textSize = 11f
      setPadding(32, 48, 32, 48)
      typeface = android.graphics.Typeface.MONOSPACE
      setText("ENGRAM failed to start.\\n\\nPlease screenshot this and send it back:\\n\\n$trace")
    }
    setContentView(ScrollView(this).apply {
      setBackgroundColor(Color.parseColor("#101410"))
      addView(text)
    })
  }

  companion object {
    const val EXTRA_TRACE = "trace"
  }
}
`,
      );
      return cfg;
    },
  ]);
}

module.exports = function withAndroidLaunchReliability(config) {
  config = withSupportedArchitectures(config);
  config = withHermesCompatibility(config);
  config = withStartupCrashHandler(config);
  return config;
};