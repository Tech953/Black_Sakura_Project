module.exports = function (api) {
  api.cache(true);
  const flowStripPlugin = require.resolve(
    "@babel/plugin-transform-flow-strip-types",
    { paths: [require("node:path").dirname(require.resolve("babel-preset-expo"))] },
  );
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    overrides: [
      {
        // Flow declarations must be stripped before class fields are lowered.
        // React Native's VirtualizedList declares `state: State;`; if this
        // type-only field is emitted, it redefines React's state property and
        // crashes during list construction on Android.
        plugins: [
          flowStripPlugin,
          // Hermes' bundled hermesc rejects untranspiled private class
          // fields/methods that some dependencies ship; down-compile them.
          "@babel/plugin-transform-class-properties",
          "@babel/plugin-transform-private-methods",
          "@babel/plugin-transform-private-property-in-object",
          // hermesc supports async functions but NOT async arrow
          // functions; converting arrows makes them compile.
          "@babel/plugin-transform-arrow-functions",
        ],
      },
    ],
  };
};
