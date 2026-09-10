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

// expo-sqlite's browser adapter loads wa-sqlite as a WebAssembly asset. Expo's
// default Metro asset list does not include wasm, so the web bundle fails while
// resolving the offline store and repeatedly reloads instead of rendering.
config.resolver = {
  ...config.resolver,
  assetExts: [...config.resolver.assetExts, "wasm", "woff2"],
};

module.exports = config;
