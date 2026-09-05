import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { conversations, engramsTable } from "@workspace/db/schema";
import type { EngramArtifact } from "@workspace/db";

/**
 * Archival engram branches (e.g. "Full Rezz") are preserved read-only for
 * continuity fidelity. NO write path may touch them: config, tuning,
 * activation, transmissions (including seen state), inquiries, chat, world
 * model, hub movement, simulations, media perception, or generated artifacts.
 * Every engram-associated write route and worker must check this.
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

/** True when either ownership edge of a generated artifact reaches an archive. */
export async function artifactTouchesArchive(
  artifact: Pick<EngramArtifact, "engramId" | "conversationId">,
): Promise<boolean> {
  if (await isArchivalEngram(artifact.engramId)) return true;
  if (artifact.conversationId == null) return false;
  const [conversation] = await db
    .select({ engramId: conversations.engramId })
    .from(conversations)
    .where(eq(conversations.id, artifact.conversationId));
  return isArchivalEngram(conversation?.engramId);
}
