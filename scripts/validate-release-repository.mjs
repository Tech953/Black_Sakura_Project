import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveReleaseRepo } from "./validate-download-release.mjs";

export function validateReleaseRepositorySource(env = process.env) {
  const releaseRepo = resolveReleaseRepo(env);
  const sourceRepo = env.RELEASE_SOURCE_REPO?.trim() || null;
  const isTaggedPush =
    env.RELEASE_EVENT_NAME === "push" && env.RELEASE_REF_TYPE === "tag";

  if (sourceRepo && sourceRepo.toLowerCase() !== releaseRepo.toLowerCase()) {
    throw new Error(
      `Repository drift detected: this build is running from "${sourceRepo}", but the configured release repository is "${releaseRepo}". Set VITE_GITHUB_REPO to the repository that owns this build.`,
    );
  }

  return { releaseRepo, sourceRepo, isTaggedPush };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const result = validateReleaseRepositorySource();
    const source = result.sourceRepo ?? "local build";
    console.log(
      `Release repository configuration verified: ${result.releaseRepo} (source: ${source}; tagged release: ${result.isTaggedPush ? "yes" : "no"}).`,
    );
  } catch (error) {
    console.error(
      `Release repository validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
