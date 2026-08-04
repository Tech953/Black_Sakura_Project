import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { engramsTable } from "@workspace/db/schema";

/**
 * Archival engram branches (e.g. "Full Rezz") are preserved read-only for
 * continuity fidelity. NO write path may touch them: config, tuning,
 * activation, transmissions, chat, world model, hub movement, simulations,
 * or media perception. Every engram-associated write route must check this.
 */
export const ARCHIVAL_READ_ONLY_ERROR =
  "This engram is a permanent archival branch preserved for continuity fidelity. It is read-only and cannot be altered.";

/** True when the given engram id refers to an archival (read-only) branch. */
export async function isArchivalEngram(engramId: number | null | undefined): Promise<boolean> {
  if (engramId == null) return false;
  const [row] = await db
    .select({ isArchival: engramsTable.isArchival })
    .from(engramsTable)
    .where(eq(engramsTable.id, engramId));
  return row?.isArchival ?? false;
}
