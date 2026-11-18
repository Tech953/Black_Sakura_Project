import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    // Uses node:test, not Vitest; it runs via `node --test` in the package
    // "test" script instead (Vitest reports "No test suite found" for it).
    exclude: ["**/node_modules/**", "scripts/prepare-full-rezz-assets.test.mjs"],
  },
});
