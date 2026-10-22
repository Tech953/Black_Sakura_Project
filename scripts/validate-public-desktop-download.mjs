import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE_URL_ENV = "ENGRAM_PUBLIC_API_URL";

export function resolvePublicApiUrl(env = process.env) {
  const raw = env[BASE_URL_ENV]?.trim();
  if (!raw) {
    throw new Error(
      `${BASE_URL_ENV} must be set to the published app URL (for example, https://example.replit.app).`,
    );
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${BASE_URL_ENV} must be a valid HTTPS URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error(`${BASE_URL_ENV} must be a credential-free HTTPS URL.`);
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function requireStorageBackedWindowsZip(metadata) {
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Desktop download metadata was not a JSON object.");
  }
  if (metadata.available !== true) {
    throw new Error("The published desktop download is not available.");
  }
  if (metadata.source !== "storage") {
    throw new Error(
      `Expected an App Storage-backed desktop download, received source ${JSON.stringify(metadata.source)}.`,
    );
  }
  if (!Array.isArray(metadata.installers)) {
    throw new Error("Desktop download metadata did not include installers.");
  }

  const installer = metadata.installers.find(
    (item) =>
      item &&
      typeof item === "object" &&
      item.os === "win" &&
      item.ext === ".zip",
  );
  if (!installer) {
    throw new Error(
      "Desktop download metadata did not include a Windows .zip installer.",
    );
  }
  if (
    typeof installer.filename !== "string" ||
    !installer.filename.toLowerCase().endsWith(".zip")
  ) {
    throw new Error("The Windows installer filename is not a .zip file.");
  }
  if (!Number.isSafeInteger(installer.sizeBytes) || installer.sizeBytes <= 0) {
    throw new Error("The Windows installer size must be a positive integer.");
  }
  if (
    typeof installer.downloadPath !== "string" ||
    !installer.downloadPath.startsWith("/api/download/desktop/file/")
  ) {
    throw new Error("The Windows installer has an invalid download path.");
  }
  return installer;
}

export async function validatePublicDesktopDownload({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error(
      "The public download check cannot run because fetch is unavailable.",
    );
  }

  const baseUrl = resolvePublicApiUrl(env);
  const metadataUrl = new URL("/api/download/desktop", baseUrl);
  const metadataResponse = await fetchImpl(metadataUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent": "engram-public-download-validation",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!metadataResponse.ok) {
    throw new Error(
      `Desktop download metadata returned HTTP ${metadataResponse.status}.`,
    );
  }

  const installer = requireStorageBackedWindowsZip(
    await metadataResponse.json(),
  );
  const downloadUrl = new URL(installer.downloadPath, baseUrl);
  if (downloadUrl.origin !== baseUrl.origin) {
    throw new Error(
      "The Windows installer download path escaped the published app.",
    );
  }

  const redirectResponse = await fetchImpl(downloadUrl, {
    redirect: "manual",
    headers: {
      Accept: "application/octet-stream",
      "User-Agent": "engram-public-download-validation",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (redirectResponse.status !== 302) {
    throw new Error(
      `Expected the Windows installer endpoint to return HTTP 302 without streaming the archive; received HTTP ${redirectResponse.status}.`,
    );
  }

  const location = redirectResponse.headers.get("location");
  let redirectUrl;
  try {
    redirectUrl = new URL(location ?? "");
  } catch {
    throw new Error("The Windows installer redirect Location is invalid.");
  }
  if (redirectUrl.protocol !== "https:") {
    throw new Error("The Windows installer redirect Location must use HTTPS.");
  }

  return {
    baseUrl: baseUrl.href.replace(/\/$/, ""),
    filename: installer.filename,
    sizeBytes: installer.sizeBytes,
    status: redirectResponse.status,
    redirectOrigin: redirectUrl.origin,
  };
}

async function main() {
  const result = await validatePublicDesktopDownload();
  console.log(
    `Published Windows download validated: ${result.filename} (${result.sizeBytes} bytes), HTTP ${result.status} to ${result.redirectOrigin}`,
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
      `Published Windows download validation failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}
