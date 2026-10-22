export type MediaProcessingFailureKind = "provider" | "extraction";
export type MediaFailureKind = MediaProcessingFailureKind | "recovered";

const STORED_FAILURE_PREFIX = "ENGRAM_MEDIA_FAILURE_V1:";

/**
 * A classified processing error. The category is stored with the diagnostic in
 * MediaAsset.error so it survives retries and restarts without a schema change.
 */
export class MediaProcessingFailure extends Error {
  constructor(
    readonly failureKind: MediaProcessingFailureKind,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MediaProcessingFailure";
  }
}

export function encodeStoredMediaFailure(
  failureKind: MediaProcessingFailureKind,
  diagnostic: string,
): string {
  return `${STORED_FAILURE_PREFIX}${failureKind}\n${diagnostic}`;
}

/**
 * Decode the versioned internal marker while leaving legacy/unclassified errors
 * intact for diagnostics. The recovery category is handled by its stable legacy
 * sentinel in media-store.ts.
 */
export function decodeStoredMediaFailure(error: string | null | undefined): {
  failureKind: MediaProcessingFailureKind | null;
  diagnostic: string | null;
} {
  if (error == null) return { failureKind: null, diagnostic: null };

  for (const failureKind of ["provider", "extraction"] as const) {
    const marker = `${STORED_FAILURE_PREFIX}${failureKind}\n`;
    if (error.startsWith(marker)) {
      return {
        failureKind,
        diagnostic: error.slice(marker.length),
      };
    }
  }

  return { failureKind: null, diagnostic: error };
}
