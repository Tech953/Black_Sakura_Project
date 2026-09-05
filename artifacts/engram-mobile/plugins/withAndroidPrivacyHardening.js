/**
 * Keep Android's backup and permission policy intact when Expo regenerates
 * android/ during `prebuild --clean`.
 */
const {
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const REQUIRED_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.VIBRATE",
];
const REMOVED_PERMISSIONS = new Set([
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.RECORD_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW",
]);

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="database" path="." />
  <exclude domain="file" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
  <exclude domain="root" path="." />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup disableIfNoEncryptionCapabilities="true">
    <exclude domain="database" path="." />
    <exclude domain="file" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="root" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="database" path="." />
    <exclude domain="file" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
    <exclude domain="root" path="." />
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withAndroidPrivacyHardening(config) {
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    for (const key of ["uses-permission", "uses-permission-sdk-23"]) {
      manifest[key] = (manifest[key] ?? []).filter(
        (permission) => !REMOVED_PERMISSIONS.has(permission.$?.["android:name"]),
      );
    }

    const permissions = manifest["uses-permission"] ?? [];
    for (const name of REQUIRED_PERMISSIONS) {
      if (!permissions.some((permission) => permission.$?.["android:name"] === name)) {
        permissions.push({ $: { "android:name": name } });
      }
    }
    manifest["uses-permission"] = permissions;

    const application = manifest.application?.[0];
    if (!application) {
      throw new Error("withAndroidPrivacyHardening: AndroidManifest has no application");
    }
    application.$ = application.$ ?? {};
    application.$["android:allowBackup"] = "false";
    application.$["android:fullBackupContent"] = "@xml/backup_rules";
    application.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    return cfg;
  });

  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const xmlDirectory = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      fs.mkdirSync(xmlDirectory, { recursive: true });
      fs.writeFileSync(path.join(xmlDirectory, "backup_rules.xml"), BACKUP_RULES);
      fs.writeFileSync(
        path.join(xmlDirectory, "data_extraction_rules.xml"),
        DATA_EXTRACTION_RULES,
      );
      return cfg;
    },
  ]);
};