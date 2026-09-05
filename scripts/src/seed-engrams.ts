import { db, closeDb } from "@workspace/db";
import { seedEngrams, seedRebeccaNarrativeMemories } from "@workspace/db/seed";

async function main() {
  const { inserted, total } = await seedEngrams(db);
  const narrativeMemories = await seedRebeccaNarrativeMemories(db);
  console.log(
    `Seeded engrams: ${inserted} inserted, ${total - inserted} already present.`,
  );
  console.log(
    `Seeded Rebecca narrative memories: ${narrativeMemories.nodesInserted} nodes inserted, ` +
      `${narrativeMemories.nodesTotal - narrativeMemories.nodesInserted} already present` +
      `${narrativeMemories.memorySeedUpdated ? "; memory seed backfilled." : "."}`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
