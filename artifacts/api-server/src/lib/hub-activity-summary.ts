/** Shared character ceiling for narrative excerpts embedded in Hub activity. */
export const HUB_ACTIVITY_EXCERPT_MAX = 180;

/**
 * Flatten whitespace and bound only the narrative excerpt. Callers retain
 * ownership of the human-readable prefix, suffix, and structured event metadata.
 */
export function normalizeHubActivityExcerpt(excerpt: string): string {
  return excerpt.replace(/\s+/g, " ").trim().slice(0, HUB_ACTIVITY_EXCERPT_MAX);
}