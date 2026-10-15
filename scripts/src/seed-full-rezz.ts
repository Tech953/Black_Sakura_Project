import { db, closeDb } from "@workspace/db";
import { seedFullRezzArchive } from "@workspace/db/seed";

async function main() {
  const { engramInserted, messagesInserted } = await seedFullRezzArchive(db);
  console.log(
    engramInserted
      ? `Full Rezz archive created: ${messagesInserted} transcript messages preserved.`
      : "Full Rezz archive already present — left untouched.",
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
