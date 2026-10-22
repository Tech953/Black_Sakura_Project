import { Storage } from "@google-cloud/storage";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..");
const explicitPath = process.argv.slice(2).find((arg) => arg !== "--");
const localPath = path.resolve(
  explicitPath || path.join(repoRoot, "downloads/ENGRAM-0.1.0-x64.zip"),
);
const filename = path.basename(localPath);
const relativeObject =
  process.env.DESKTOP_DOWNLOAD_OBJECT_NAME || `downloads/${filename}`;
const searchPath = process.env.PUBLIC_OBJECT_SEARCH_PATHS?.split(",")
  .map((value) => value.trim())
  .find(Boolean);

if (!searchPath) {
  throw new Error("PUBLIC_OBJECT_SEARCH_PATHS is not configured");
}
if (
  relativeObject.startsWith("/") ||
  relativeObject.split("/").some((part) => part === "..")
) {
  throw new Error("DESKTOP_DOWNLOAD_OBJECT_NAME must be a safe relative path");
}

const fullObjectPath = `${searchPath.replace(/\/+$/, "")}/${relativeObject}`;
const parts = fullObjectPath.startsWith("/")
  ? fullObjectPath.split("/")
  : `/${fullObjectPath}`.split("/");
const bucketName = parts[1];
const objectName = parts.slice(2).join("/");
if (!bucketName || !objectName) throw new Error("Invalid App Storage path");

const storage = new Storage({
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

const source = await stat(localPath);
if (!source.isFile()) throw new Error("Desktop installer source is not a file");

const destination = storage.bucket(bucketName).file(objectName);
console.log(`Uploading ${filename} (${source.size} bytes) to App Storage...`);
await pipeline(
  createReadStream(localPath),
  destination.createWriteStream({
    resumable: true,
    validation: "crc32c",
    metadata: {
      contentType: "application/zip",
      contentDisposition: `attachment; filename="${filename.replace(/"/g, "")}"`,
      cacheControl: "public, max-age=3600",
    },
  }),
);

const [metadata] = await destination.getMetadata();
if (Number(metadata.size) !== source.size) {
  throw new Error("Uploaded object size does not match the local installer");
}
console.log(`Uploaded ${filename}; size verified (${source.size} bytes).`);