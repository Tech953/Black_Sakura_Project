module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    overrides: [
      {
        // Hermes' bundled hermesc rejects untranspiled private class
        // fields/methods that some dependencies ship; down-compile them.
        plugins: [
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
