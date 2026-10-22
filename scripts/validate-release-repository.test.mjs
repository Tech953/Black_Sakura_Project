import assert from "node:assert/strict";
import test from "node:test";
import { validateReleaseRepositorySource } from "./validate-release-repository.mjs";

test("allows fork branch builds when they target their own repository", () => {
  const result = validateReleaseRepositorySource({
    RELEASE_SOURCE_REPO: "fork-owner/engram",
    RELEASE_EVENT_NAME: "push",
    RELEASE_REF_TYPE: "branch",
    VITE_GITHUB_REPO: "fork-owner/engram",
  });

  assert.equal(result.sourceRepo, "fork-owner/engram");
  assert.equal(result.releaseRepo, "fork-owner/engram");
  assert.equal(result.isTaggedPush, false);
});

test("allows a tag push when source and release repositories match", () => {
  const result = validateReleaseRepositorySource({
    RELEASE_SOURCE_REPO: "Tech953/Ch-IO",
    RELEASE_EVENT_NAME: "push",
    RELEASE_REF_TYPE: "tag",
    VITE_GITHUB_REPO: "Tech953/Ch-IO",
  });

  assert.equal(result.isTaggedPush, true);
  assert.equal(result.releaseRepo, result.sourceRepo);
});

test("rejects a tag push from a fork or staging repository before release creation", () => {
  assert.throws(
    () =>
      validateReleaseRepositorySource({
        RELEASE_SOURCE_REPO: "fork-owner/engram",
        RELEASE_EVENT_NAME: "push",
        RELEASE_REF_TYPE: "tag",
      }),
    /Repository drift detected: this build is running from "fork-owner\/engram", but the configured release repository is "Tech953\/Ch-IO"/,
  );
});

test("rejects release repository drift in staging and fork branch builds", () => {
  assert.throws(
    () =>
      validateReleaseRepositorySource({
        RELEASE_SOURCE_REPO: "staging-owner/engram",
        RELEASE_EVENT_NAME: "push",
        RELEASE_REF_TYPE: "branch",
        VITE_GITHUB_REPO: "production-owner/engram",
      }),
    /Repository drift detected: this build is running from "staging-owner\/engram", but the configured release repository is "production-owner\/engram"/,
  );
  assert.throws(
    () =>
      validateReleaseRepositorySource({
        RELEASE_SOURCE_REPO: "fork-owner/engram",
        RELEASE_EVENT_NAME: "push",
        RELEASE_REF_TYPE: "branch",
        VITE_GITHUB_REPO: "Tech953/Ch-IO",
      }),
    /Repository drift detected/,
  );
});
