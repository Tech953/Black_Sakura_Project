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

test("retries a transient response before succeeding", async () => {
  const statuses = [503, 429, 302];
  const delays = [];
  const result = await validateDownloadRelease({
    env: { VITE_GITHUB_REPO: "acme/engram" },
    fetchImpl: async () => ({ status: statuses.shift() }),
    sleepImpl: async (delay) => {
      delays.push(delay);
    },
    retryDelay: (attempt) => attempt * 10,
  });

  assert.equal(result.status, 302);
  assert.deepEqual(delays, [10, 20]);
});

test("retries network errors and reports the final error after exhaustion", async () => {
  let requests = 0;
  const delays = [];
  await assert.rejects(
    validateDownloadRelease({
      env: { VITE_GITHUB_REPO: "acme/engram" },
      fetchImpl: async () => {
        requests += 1;
        throw new Error("temporary timeout");
      },
      sleepImpl: async (delay) => {
        delays.push(delay);
      },
      retryDelay: (attempt) => attempt * 10,
    }),
    /GitHub release URL is unreachable .*temporary timeout/,
  );

  assert.equal(requests, 3);
  assert.deepEqual(delays, [10, 20]);
});

test("reports a transient HTTP failure after bounded retries", async () => {
  let requests = 0;
  await assert.rejects(
    validateDownloadRelease({
      env: { VITE_GITHUB_REPO: "acme/engram" },
      fetchImpl: async () => {
        requests += 1;
        return { status: 503 };
      },
      sleepImpl: async () => {},
      retryDelay: () => 0,
    }),
    /GitHub returned HTTP 503/,
  );

  assert.equal(requests, 3);
});

test("reports a missing latest release clearly", async () => {
  let requests = 0;
  await assert.rejects(
    validateDownloadRelease({
      env: { VITE_GITHUB_REPO: "acme/engram" },
      fetchImpl: async () => {
        requests += 1;
        return { status: 404 };
      },
    }),
    /repository or its latest release was not found/,
  );
  assert.equal(requests, 1);
});
