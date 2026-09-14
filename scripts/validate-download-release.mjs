import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_GITHUB_REPO = "Tech953/Ch-IO";
export const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PLACEHOLDER_PART_RE =
  /^(?:your|owner|org|organization|repo|repository|example|sample|placeholder|changeme)(?:[-_.].*)?$/i;
const SKIP_NETWORK_ENV = "ENGRAM_RELEASE_CHECK_SKIP_NETWORK";

function isCiEnvironment(env) {
  return env.CI === "1" || env.CI === "true" || env.GITHUB_ACTIONS === "true";
}

export function resolveReleaseRepo(env = process.env) {
  const repo = (env.VITE_GITHUB_REPO ?? DEFAULT_GITHUB_REPO).trim();
  if (!GITHUB_REPO_RE.test(repo)) {
    throw new Error(
      `VITE_GITHUB_REPO must be an owner/repo value, received "${repo}".`,
    );
  }

  const [owner, name] = repo.split("/");
  if (PLACEHOLDER_PART_RE.test(owner) || PLACEHOLDER_PART_RE.test(name)) {
    throw new Error(
      `VITE_GITHUB_REPO still contains a placeholder value ("${repo}"). Set it to the real GitHub owner/repository.`,
    );
  }

  return repo;
}

export function releaseUrlForRepo(repo) {
  return `https://github.com/${repo}/releases/latest`;
}

export async function validateDownloadRelease({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const repo = resolveReleaseRepo(env);
  const releaseUrl = releaseUrlForRepo(repo);
  const skipNetwork =
    env[SKIP_NETWORK_ENV] === "1" || process.argv.includes("--skip-network");

  if (skipNetwork) {
    if (isCiEnvironment(env)) {
      throw new Error(
        `${SKIP_NETWORK_ENV}=1 is for local development only and cannot disable the production release check in CI.`,
      );
    }
    return { repo, releaseUrl, networkChecked: false };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error(
      "The release check cannot run because fetch is unavailable.",
    );
  }

  let response;
  try {
    response = await fetchImpl(releaseUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html",
        "User-Agent": "engram-release-link-validation",
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `GitHub release URL is unreachable (${releaseUrl}): ${detail}`,
    );
  }

  if (response.status < 200 || response.status >= 400) {
    const missing =
      response.status === 404
        ? "The repository or its latest release was not found."
        : `GitHub returned HTTP ${response.status}.`;
    throw new Error(
      `GitHub release URL check failed for ${releaseUrl}. ${missing}`,
    );
  }

  return { repo, releaseUrl, networkChecked: true, status: response.status };
}

async function main() {
  const result = await validateDownloadRelease();
  const mode = result.networkChecked ? "reachable" : "format-only (local skip)";
  console.log(
    `Download release link validated: ${result.releaseUrl} [${mode}]`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    await main();
  } catch (error) {
    console.error(
      `Download release link validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
