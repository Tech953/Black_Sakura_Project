import type { AppDatabase } from "../index";
import { seedExpressions } from "./expressions";
import { seedEngrams } from "./engrams";
import { seedHub } from "./hub";
import { seedFullRezzArchive } from "./full-rezz";
import {
  REBECCA_NARRATIVE_MEMORY_FACTS,
  REBECCA_NARRATIVE_MEMORY_NODES,
} from "./rebecca-narrative-memory-data";
import { seedRebeccaNarrativeMemories } from "./rebecca-narrative-memories";
import {
  buildRebeccaAdaptiveMemorySource,
  REBECCA_ADAPTIVE_MEMORY_FACTS,
  REBECCA_ADAPTIVE_MEMORY_SOURCE_PREFIX,
  REBECCA_ADAPTIVE_MEMORY_NODES,
  REBECCA_ADAPTIVE_SOURCE_CATALOG,
  REBECCA_ADAPTIVE_SOURCE_AUTHORITIES,
} from "./rebecca-adaptive-data";
import { seedRebeccaAdaptiveProfile } from "./rebecca-adaptive-profile";

export {
  seedExpressions,
  seedEngrams,
  seedHub,
  seedFullRezzArchive,
  REBECCA_NARRATIVE_MEMORY_FACTS,
  REBECCA_NARRATIVE_MEMORY_NODES,
  seedRebeccaNarrativeMemories,
  REBECCA_ADAPTIVE_MEMORY_FACTS,
  REBECCA_ADAPTIVE_MEMORY_SOURCE_PREFIX,
  REBECCA_ADAPTIVE_MEMORY_NODES,
  REBECCA_ADAPTIVE_SOURCE_CATALOG,
  REBECCA_ADAPTIVE_SOURCE_AUTHORITIES,
  buildRebeccaAdaptiveMemorySource,
  seedRebeccaAdaptiveProfile,
};

/**
 * Run every idempotent seed in dependency order: reference expressions, engram
 * personas, then Hub spaces (which backfills engram presence). Safe to run on
 * every launch — each seed uses `onConflictDoNothing`.
 */
export async function seedAll(db: AppDatabase): Promise<{
  expressions: { inserted: number; total: number };
  engrams: { inserted: number; total: number };
  rebeccaNarrativeMemories: {
    nodesInserted: number;
    nodesTotal: number;
    memorySeedUpdated: boolean;
  };
  rebeccaAdaptiveProfile: {
    nodesInserted: number;
    nodesTotal: number;
    profileUpdated: boolean;
  };
  hub: { spacesInserted: number; spacesTotal: number; placed: number };
  fullRezz: { engramInserted: boolean; messagesInserted: number };
}> {
  const expressions = await seedExpressions(db);
  const engrams = await seedEngrams(db);
  const rebeccaNarrativeMemories = await seedRebeccaNarrativeMemories(db);
  const rebeccaAdaptiveProfile = await seedRebeccaAdaptiveProfile(db);
  const hub = await seedHub(db);
  const fullRezz = await seedFullRezzArchive(db);
  return {
    expressions,
    engrams,
    rebeccaNarrativeMemories,
    rebeccaAdaptiveProfile,
    hub,
    fullRezz,
  };
}
