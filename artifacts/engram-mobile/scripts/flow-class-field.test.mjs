import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const appRequire = createRequire(path.join(appDirectory, "package.json"));
const babel = appRequire("@babel/core");
const reactNativePackage = appRequire.resolve("react-native/package.json");
const reactNativeRequire = createRequire(reactNativePackage);
const virtualizedListPath = reactNativeRequire.resolve(
  "@react-native/virtualized-lists/Lists/VirtualizedList",
);

test("Flow-only VirtualizedList state is stripped before class-field lowering", () => {
  const source = appRequire("node:fs").readFileSync(virtualizedListPath, "utf8");
  assert.match(source, /^\s*state:\s*State;\s*$/m);

  const { code } = babel.transformSync(source, {
    babelrc: false,
    configFile: path.join(appDirectory, "babel.config.js"),
    filename: virtualizedListPath,
    sourceMaps: false,
  });

  assert.doesNotMatch(
    code,
    /(?:_defineProperty(?:\d+)?(?:\.default)?|Object\.defineProperty)\([^;\n]*["']state["']/,
    "the type-only state declaration must not become a runtime property definition",
  );
  assert.doesNotMatch(code, /^\s*state:\s*State;\s*$/m);
});
