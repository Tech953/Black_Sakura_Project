import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Most database suites boot isolated PGlite instances. Running all of
    // those engines at once makes startup timing nondeterministic in CI and
    // can starve the application workflows during a release-gate run.
    fileParallelism: false,
  },
});
