const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// Force the Hermes transform profile so release bundles down-compile
// classes/async/private fields to what the bundled hermesc accepts.
// Without this the release bundle fails hermesc with
// "invalid statement encountered" on untranspiled `class` declarations.
config.transformer = {
  ...config.transformer,
  unstable_transformProfile: "hermes-stable",
};

module.exports = config;
