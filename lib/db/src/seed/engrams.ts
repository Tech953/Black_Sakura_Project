import { engramsTable } from "../schema";
import type { AppDatabase } from "../index";
import { engramSeedData } from "./engram-data";

/** Idempotently seed the engram personas (keyed on `slug`). */
export async function seedEngrams(
  db: AppDatabase,
): Promise<{ inserted: number; total: number }> {
  const result = await db
    .insert(engramsTable)
    .values(engramSeedData)
    .onConflictDoNothing({
      target: [engramsTable.ownerId, engramsTable.slug],
    })
    .returning({ slug: engramsTable.slug });
  return { inserted: result.length, total: engramSeedData.length };
}
