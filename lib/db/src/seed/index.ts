import type { AppDatabase } from "../index";
import { seedExpressions } from "./expressions";
import { seedEngrams } from "./engrams";
import { seedHub } from "./hub";
import { seedFullRezzArchive } from "./full-rezz";

export { seedExpressions, seedEngrams, seedHub, seedFullRezzArchive };

/**
 * Run every idempotent seed in dependency order: reference expressions, engram
 * personas, then Hub spaces (which backfills engram presence). Safe to run on
 * every launch — each seed uses `onConflictDoNothing`.
 */
export async function seedAll(db: AppDatabase): Promise<{
  expressions: { inserted: number; total: number };
  engrams: { inserted: number; total: number };
  hub: { spacesInserted: number; spacesTotal: number; placed: number };
  fullRezz: { engramInserted: boolean; messagesInserted: number };
}> {
  const expressions = await seedExpressions(db);
  const engrams = await seedEngrams(db);
  const hub = await seedHub(db);
  const fullRezz = await seedFullRezzArchive(db);
  return { expressions, engrams, hub, fullRezz };
}
