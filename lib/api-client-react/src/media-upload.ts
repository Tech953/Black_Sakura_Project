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

function extensionOf(filename: string): string {
  const basename = filename.trim().split(/[\\/]/).pop() ?? "";
  const dot = basename.lastIndexOf(".");
  return dot > 0 ? basename.slice(dot).toLowerCase() : "";
}

/**
 * Normalize MIME values reported by browser File objects and native document
 * pickers. Only an empty/generic value is inferred from an unambiguous
 * extension; a specific unsupported type is preserved so the API can reject it.
 */
export function normalizeMediaUploadMimeType(
  filename: string,
  reportedMimeType: string | null | undefined,
): string {
  const raw = (reportedMimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const canonical = MIME_ALIASES[raw] ?? raw;
  if (canonical && canonical !== "application/octet-stream") return canonical;
  return (
    (MIME_BY_EXTENSION[extensionOf(filename)] ?? canonical) ||
    "application/octet-stream"
  );
}