import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../index";
import {
  engramWorldModelTable,
  engramsTable,
  SYSTEM_OWNER_ID,
} from "../schema";
import {
  REBECCA_NARRATIVE_MEMORY_FACTS,
  REBECCA_NARRATIVE_MEMORY_NODES,
} from "./rebecca-narrative-memory-data";

export { REBECCA_NARRATIVE_MEMORY_FACTS, REBECCA_NARRATIVE_MEMORY_NODES };

export const REBECCA_BASE_SLUG = "rebecca";
export const REBECCA_NARRATIVE_MEMORY_SOURCE_PREFIX =
  "seed:rebecca-narrative-simulation:";

export type RebeccaNarrativeMemorySeedResult = {
  nodesInserted: number;
  nodesTotal: number;
  memorySeedUpdated: boolean;
};

/**
 * Backfill the mutable base Rebecca engram with distilled simulation memories.
 *
 * The source key is stable per node, so this is safe to run at every database
 * bootstrap. Existing rows are validated rather than silently relabeled or
 * overwritten. Only the base `rebecca` row is eligible; the archival
 * `rebecca-full-rezz` branch is intentionally never selected.
 */
export async function seedRebeccaNarrativeMemories(
  db: AppDatabase,
): Promise<RebeccaNarrativeMemorySeedResult> {
  const [baseRebecca] = await db
    .select()
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.ownerId, SYSTEM_OWNER_ID),
        eq(engramsTable.slug, REBECCA_BASE_SLUG),
      ),
    );

  if (!baseRebecca) {
    return {
      nodesInserted: 0,
      nodesTotal: REBECCA_NARRATIVE_MEMORY_NODES.length,
      memorySeedUpdated: false,
    };
  }

  return db.transaction(async (tx) => {
    const existingNodes = await tx
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, baseRebecca.id));
    const bySource = new Map(
      existingNodes
        .filter((entry) => entry.source)
        .map((entry) => [entry.source as string, entry]),
    );

    let nodesInserted = 0;
    for (const node of REBECCA_NARRATIVE_MEMORY_NODES) {
      const source = `${REBECCA_NARRATIVE_MEMORY_SOURCE_PREFIX}${node.source}:${node.slug}`;
      const existing = bySource.get(source);
      if (existing) {
        if (
          existing.provenance !== "simulated" ||
          existing.content !== node.content ||
          existing.confidence !== 0.7 ||
          existing.scope !== "private"
        ) {
          throw new Error(
            `Rebecca narrative memory has noncanonical seeded row: ${source}`,
          );
        }
        continue;
      }

      await tx.insert(engramWorldModelTable).values({
        engramId: baseRebecca.id,
        provenance: "simulated",
        content: node.content,
        confidence: 0.7,
        scope: "private",
        source,
      });
      nodesInserted += 1;
    }

    const existingFacts = Array.isArray(baseRebecca.memorySeed?.facts)
      ? baseRebecca.memorySeed.facts
      : [];
    const mergedFacts = [...existingFacts];
    for (const fact of REBECCA_NARRATIVE_MEMORY_FACTS) {
      if (!mergedFacts.includes(fact)) mergedFacts.push(fact);
    }
    const memorySeedUpdated = mergedFacts.length !== existingFacts.length;
    if (memorySeedUpdated) {
      await tx
        .update(engramsTable)
        .set({
          memorySeed: {
            ...baseRebecca.memorySeed,
            facts: mergedFacts,
          },
          updatedAt: new Date(),
        })
        .where(eq(engramsTable.id, baseRebecca.id));
    }

    return {
      nodesInserted,
      nodesTotal: REBECCA_NARRATIVE_MEMORY_NODES.length,
      memorySeedUpdated,
    };
  });
}