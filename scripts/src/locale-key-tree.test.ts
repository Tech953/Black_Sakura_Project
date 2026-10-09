import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  diffKeyTrees,
  findEnglishFallbackKeys,
  findMissingInstallGuidanceMarkers,
  keysMatch,
} from "./locale-key-tree.js";

const VALID_ENGLISH_INSTALL_GUIDANCE = {
  installMac:
    "Open ENGRAM from Finder. If Gatekeeper warns, right-click the app, choose Open, and confirm. Signing and notarization are opt-in, so unsigned or unnotarized builds may show this warning.",
  requirementsMac: "A Mac with Apple Silicon or Intel.",
  installWin:
    "Run the .exe installer. If SmartScreen appears for an unsigned build, choose More info, then Run anyway. Code signing is opt-in.",
  requirementsWin: "64-bit Windows 10 or 11.",
  installLinux:
    "For AppImage, use chmod +x. You may also install the .deb. If it reports a FUSE error, install the compatibility package.",
  requirementsLinux:
    "A 64-bit Linux distribution; the .deb declares the dependencies.",
  installAndroid:
    "Open the APK. Android APKs are sideloaded; release signing is not guaranteed for every build.",
  requirementsAndroid:
    "Android 8 or newer, plus permission to install the APK.",
};

describe("locale key tree comparison", () => {
  it("accepts translated values when their structure is unchanged", () => {
    const english = { mobile: { title: "Settings", count: "{{count}} items" } };
    const translated = {
      mobile: { title: "Configuración", count: "{{count}} elementos" },
    };
    assert.equal(keysMatch(english, translated), true);
  });

  it("reports nested missing, extra, and structurally invalid keys", () => {
    const english = {
      mobile: {
        title: "Settings",
        nested: { saved: "Saved" },
        status: "Ready",
      },
    };
    const generated = {
      mobile: {
        nested: { removed: "Eliminado" },
        status: { ready: "Listo" },
        obsolete: "Old",
      },
    };
    assert.deepEqual(diffKeyTrees(english, generated), {
      missing: ["mobile.nested.saved", "mobile.title"],
      extra: ["mobile.nested.removed", "mobile.obsolete"],
      typeMismatches: [
        "mobile.status (expected string, got object)",
      ],
    });
  });

  it("reports English fallback values only for tracked mobile labels", () => {
    const english = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "Telemetry",
        noActivity: "No Hub activity yet.",
        unrelated: "Existing English copy",
      },
      environment: {
        unavailable: "ENVIRONMENT UNAVAILABLE",
      },
    };
    const generated = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "Telemetry",
        noActivity: "Aucune activité Hub pour le moment.",
        unrelated: "Existing English copy",
      },
      environment: {
        unavailable: "Environment unavailable",
      },
    };

    assert.deepEqual(findEnglishFallbackKeys(english, generated), [
      "hub.title",
      "environment.unavailable",
    ]);
  });

  it("allows product terms alone but still flags English copy around them", () => {
    const mobile = {
      tabs: { hub: "Hub" },
      hub: {
        kicker: "ENGRAM // HUB",
        title: "PYRI",
        live: "engram",
        noActivity: "No Hub activity yet.",
      },
    };

    assert.deepEqual(findEnglishFallbackKeys(mobile, mobile), [
      "hub.noActivity",
    ]);
  });

  it("accepts English installation markers and safety instructions", () => {
    assert.deepEqual(
      findMissingInstallGuidanceMarkers(
        "en",
        VALID_ENGLISH_INSTALL_GUIDANCE,
      ),
      [],
    );
  });

  it("accepts Arabic RTL guidance with technical markers and safety notes", () => {
    const arabic = {
      installMac:
        "إذا حذّرك Gatekeeper، فانقر بزر الماوس الأيمن على التطبيق واختر «فتح». التوقيع والتوثيق اختياريان، وقد تعرض الإصدارات غير الموقّعة أو غير الموثّقة هذا التحذير.",
      requirementsMac: "جهاز Mac بمعالج Apple Silicon أو Intel.",
      installWin:
        "شغّل ‏.exe. إذا ظهر SmartScreen لإصدار غير موقّع، فاختر «مزيد من المعلومات» ثم «التشغيل على أي حال». توقيع التعليمات البرمجية اختياري.",
      requirementsWin: "نظام Windows 10 أو 11 بإصدار 64 بت.",
      installLinux:
        "اجعل AppImage قابلًا للتنفيذ باستخدام chmod +x. يمكنك تثبيت ‏.deb. إذا ظهر خطأ FUSE، فثبّت حزمة التوافق.",
      requirementsLinux:
        "توزيعة Linux بإصدار 64 بت؛ يحدّد ملف ‏.deb التبعيات.",
      installAndroid:
        "افتح APK. يتم تثبيت Android APK جانبيًا؛ لا يُضمن توقيع الإصدار لكل إصدار.",
      requirementsAndroid:
        "نظام Android 8 أو أحدث، مع إذن تثبيت APK.",
    };

    assert.deepEqual(findMissingInstallGuidanceMarkers("ar", arabic), []);
  });

  it("reports missing markers with the locale's download key", () => {
    const incomplete = {
      ...VALID_ENGLISH_INSTALL_GUIDANCE,
      installWin: "Run the installer.",
      requirementsAndroid: "Android 7 or newer, plus permission to install the APK.",
    };
    const missing = findMissingInstallGuidanceMarkers("en", incomplete);

    assert.ok(missing.includes("download.installWin: missing .exe installer"));
    assert.ok(
      missing.includes("download.installWin: missing SmartScreen warning"),
    );
    assert.ok(
      missing.includes(
        "download.installWin: missing unsigned-build SmartScreen warning",
      ),
    );
    assert.ok(
      missing.includes("download.installWin: missing More info action"),
    );
    assert.ok(
      missing.includes("download.installWin: missing run confirmation action"),
    );
    assert.ok(
      missing.includes(
        "download.requirementsAndroid: missing Android 8 and APK requirements",
      ),
    );
  });

  it("requires an explicit safety-marker profile for each locale", () => {
    const missing = findMissingInstallGuidanceMarkers("xx", {});

    assert.ok(
      missing.includes(
        'download.installMac: no safety marker profile configured for locale "xx"',
      ),
    );
  });
});