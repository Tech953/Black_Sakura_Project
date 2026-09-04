import { Storage } from "@google-cloud/storage";
import path from "node:path";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const DEFAULT_DESKTOP_OBJECT = "downloads/ENGRAM-0.1.0-x64.zip";

const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

export type StoredDesktopDownload = {
  filename: string;
  sizeBytes: number;
  url: string;
};

function parseObjectPath(rawPath: string): {
  bucketName: string;
  objectName: string;
} {
  const normalized = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const parts = normalized.split("/");
  if (parts.length < 3 || !parts[1] || !parts.slice(2).join("/")) {
    throw new Error("Invalid App Storage object path");
  }
  return {
    bucketName: parts[1],
    objectName: parts.slice(2).join("/"),
  };
}

function desktopObjectTarget(): {
  bucketName: string;
  objectName: string;
  filename: string;
} | null {
  const searchPath = process.env["PUBLIC_OBJECT_SEARCH_PATHS"]
    ?.split(",")
    .map((value) => value.trim())
    .find(Boolean);
  if (!searchPath) return null;

  const relative =
    process.env["DESKTOP_DOWNLOAD_OBJECT_NAME"]?.trim() ||
    DEFAULT_DESKTOP_OBJECT;
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.split("/").some((part) => part === "..")
  ) {
    return null;
  }

  const { bucketName, objectName } = parseObjectPath(
    `${searchPath.replace(/\/+$/, "")}/${relative}`,
  );
  return { bucketName, objectName, filename: path.basename(relative) };
}

async function signReadUrl(
  bucketName: string,
  objectName: string,
): Promise<string> {
  const response = await fetch(
    `${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bucket_name: bucketName,
        object_name: objectName,
        method: "GET",
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Could not sign App Storage URL (${response.status})`);
  }
  const body = (await response.json()) as { signed_url?: string };
  if (!body.signed_url) throw new Error("App Storage returned no signed URL");
  return body.signed_url;
}

export async function resolveStoredDesktopDownload(): Promise<StoredDesktopDownload | null> {
  const target = desktopObjectTarget();
  if (!target) return null;

  try {
    const file = objectStorageClient
      .bucket(target.bucketName)
      .file(target.objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const sizeBytes = Number(metadata.size);
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) return null;
    return {
      filename: target.filename,
      sizeBytes,
      url: await signReadUrl(target.bucketName, target.objectName),
    };
  } catch (error) {
    console.warn("App Storage desktop download lookup failed", error);
    return null;
  }
}