import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
    exclude: ["scripts/prepare-full-rezz-assets.test.mjs"],
  },
});
