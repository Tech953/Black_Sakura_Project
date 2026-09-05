import { and, eq } from "drizzle-orm";
import type { AppDatabase } from "../index";
import {
  engramWorldModelTable,
  engramsTable,
  SYSTEM_OWNER_ID,
} from "../schema";
import {
  buildRebeccaAdaptiveMemorySource,
  enrichRebeccaAdaptiveProfile,
  REBECCA_ADAPTIVE_MEMORY_NODES,
} from "./rebecca-adaptive-data";

export type RebeccaAdaptiveProfileSeedResult = {
  nodesInserted: number;
  nodesTotal: number;
  profileUpdated: boolean;
};

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Enrich only the mutable base Rebecca. The migration is additive: existing
 * drive weights/rates, custom themes, live pressure, cooldowns, and conversation
 * state are preserved. Source-stable world-model rows fail closed on drift.
 */
export async function seedRebeccaAdaptiveProfile(
  db: AppDatabase,
): Promise<RebeccaAdaptiveProfileSeedResult> {
  const [baseRebecca] = await db
    .select()
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.ownerId, SYSTEM_OWNER_ID),
        eq(engramsTable.slug, "rebecca"),
      ),
    );

  if (!baseRebecca) {
    return {
      nodesInserted: 0,
      nodesTotal: REBECCA_ADAPTIVE_MEMORY_NODES.length,
      profileUpdated: false,
    };
  }
  if (baseRebecca.isArchival) {
    throw new Error("Refusing to enrich an archival Rebecca record");
  }

  return db.transaction(async (tx) => {
    const adaptiveSources = new Set(
      REBECCA_ADAPTIVE_MEMORY_NODES.map(buildRebeccaAdaptiveMemorySource),
    );
    const existingNodes = await tx
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, baseRebecca.id));
    const bySource = new Map<string, (typeof existingNodes)[number]>();
    for (const entry of existingNodes) {
      if (!entry.source || !adaptiveSources.has(entry.source)) continue;
      if (bySource.has(entry.source)) {
        throw new Error(
          `Rebecca adaptive memory has duplicate seeded rows: ${entry.source}`,
        );
      }
      bySource.set(entry.source, entry);
    }

    let nodesInserted = 0;
    for (const node of REBECCA_ADAPTIVE_MEMORY_NODES) {
      const source = buildRebeccaAdaptiveMemorySource(node);
      const existing = bySource.get(source);
      if (existing) {
        if (
          existing.provenance !== node.provenance ||
          existing.content !== node.content ||
          existing.confidence !== node.confidence ||
          existing.scope !== "private"
        ) {
          throw new Error(
            `Rebecca adaptive memory has noncanonical seeded row: ${source}`,
          );
        }
        continue;
      }

      await tx.insert(engramWorldModelTable).values({
        engramId: baseRebecca.id,
        provenance: node.provenance,
        content: node.content,
        confidence: node.confidence,
        scope: "private",
        source,
      });
      nodesInserted += 1;
    }

    const enriched = enrichRebeccaAdaptiveProfile(baseRebecca);
    const profileUpdated =
      !sameJson(enriched.voiceProfile, baseRebecca.voiceProfile) ||
      !sameJson(enriched.memorySeed, baseRebecca.memorySeed) ||
      !sameJson(enriched.drives, baseRebecca.drives) ||
      !sameJson(enriched.focusThemes, baseRebecca.focusThemes);

    if (profileUpdated) {
      await tx
        .update(engramsTable)
        .set({
          voiceProfile: enriched.voiceProfile,
          memorySeed: enriched.memorySeed,
          drives: enriched.drives,
          focusThemes: enriched.focusThemes,
          updatedAt: new Date(),
        })
        .where(eq(engramsTable.id, baseRebecca.id));
    }

    return {
      nodesInserted,
      nodesTotal: REBECCA_ADAPTIVE_MEMORY_NODES.length,
      profileUpdated,
    };
  });
}