const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
  "video/x-m4v": "video/mp4",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  ".txt": "text/plain",
  ".text": "text/plain",
  ".log": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".m4b": "audio/mp4",
  ".m4p": "audio/mp4",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

export type WebmModality = "audio" | "video";

function extensionOf(filename: string): string {
  const basename = filename.trim().split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot).toLowerCase() : "";
}

function isGenericMimeType(mimeType: string | null | undefined): boolean {
  const raw = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return raw === "" || raw === "application/octet-stream";
}

/**
 * WebM can be audio or video, so generic picker results need an explicit
 * modality choice rather than extension-based inference.
 */
export function needsWebmModalityChoice(
  filename: string,
  reportedMimeType: string | null | undefined,
): boolean {
  return extensionOf(filename) === ".webm" && isGenericMimeType(reportedMimeType);
}

/**
 * Normalize MIME values reported by browser File objects and native document
 * pickers. Only an empty/generic value is inferred from an unambiguous
 * extension; WebM is inferred only from an explicit modality choice. A
 * specific unsupported type is preserved so the API can reject it.
 */
export function normalizeMediaUploadMimeType(
  filename: string,
  reportedMimeType: string | null | undefined,
  webmModality?: WebmModality | null,
): string {
  const raw = (reportedMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const canonical = MIME_ALIASES[raw] ?? raw;
  if (canonical && canonical !== "application/octet-stream") return canonical;
  if (extensionOf(filename) === ".webm" && webmModality) {
    return `${webmModality}/webm`;
  }
  return (
    (MIME_BY_EXTENSION[extensionOf(filename)] ?? canonical) ||
    "application/octet-stream"
  );
}