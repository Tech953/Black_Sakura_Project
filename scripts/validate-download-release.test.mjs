import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_GITHUB_REPO,
  releaseUrlForRepo,
  resolveReleaseRepo,
  validateDownloadRelease,
} from "./validate-download-release.mjs";

test("uses the shared default repository when no override is configured", () => {
  assert.equal(resolveReleaseRepo({}), DEFAULT_GITHUB_REPO);
  assert.equal(
    releaseUrlForRepo(DEFAULT_GITHUB_REPO),
    "https://github.com/Tech953/Ch-IO/releases/latest",
  );
});

test("accepts a valid repository override", () => {
  assert.equal(
    resolveReleaseRepo({ VITE_GITHUB_REPO: " fork-owner/fork-repo " }),
    "fork-owner/fork-repo",
  );
});

test("rejects malformed and placeholder repository values", () => {
  for (const value of [
    "https://github.com/owner/repo",
    "owner",
    "owner/repo/releases/latest",
    "your-org/your-repo",
    "owner/example-repo",
  ]) {
    assert.throws(() => resolveReleaseRepo({ VITE_GITHUB_REPO: value }), {
      name: "Error",
    });
  }
});

test("allows an explicit local network skip but never in CI", async () => {
  const skipped = await validateDownloadRelease({
    env: { ENGRAM_RELEASE_CHECK_SKIP_NETWORK: "1" },
    fetchImpl: () => {
      throw new Error("network should not be called");
    },
  });
  assert.equal(skipped.networkChecked, false);

  await assert.rejects(
    validateDownloadRelease({
      env: { CI: "true", ENGRAM_RELEASE_CHECK_SKIP_NETWORK: "1" },
    }),
    /local development only/,
  );
});

test("passes when the latest release endpoint is reachable", async () => {
  const requests = [];
  const result = await validateDownloadRelease({
    env: { VITE_GITHUB_REPO: "acme/engram" },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { status: 302 };
    },
  });

  assert.equal(result.networkChecked, true);
  assert.equal(result.status, 302);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "https://github.com/acme/engram/releases/latest",
  );
  assert.equal(requests[0].init.redirect, "manual");
});

test("reports a missing latest release clearly", async () => {
  await assert.rejects(
    validateDownloadRelease({
      env: { VITE_GITHUB_REPO: "acme/engram" },
      fetchImpl: async () => ({ status: 404 }),
    }),
    /repository or its latest release was not found/,
  );
});
