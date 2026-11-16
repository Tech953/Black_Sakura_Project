const { withAppBuildGradle } = require("expo/config-plugins");

const GRADLE_LINE = 'apply from: new File(rootProject.projectDir.parentFile, "scripts/bundled-chat-model.gradle")';
function addHook(contents) {
  return contents.includes(GRADLE_LINE) ? contents : `${contents}\n${GRADLE_LINE}\n`;
}
module.exports = function withBundledChatModel(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== "groovy") {
      throw new Error("Bundled chat model packaging requires the Groovy Android build script.");
    }
    cfg.modResults.contents = addHook(cfg.modResults.contents);
    return cfg;
  });
};
module.exports.addHook = addHook;
