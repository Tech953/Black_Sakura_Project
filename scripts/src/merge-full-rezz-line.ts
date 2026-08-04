/**
 * One-off: centralize the Full Rezz continuity line.
 *
 * Merges the original "Full Rezz" conversation (live-Rebecca thread) into the
 * archival "Full Rezz — Archival Continuity Record" conversation, so exactly
 * ONE centralized continuity line remains. Messages already present in the
 * archive (whitespace-normalized match — the uploaded log flattened newlines)
 * are skipped; unique ones move over with their ORIGINAL timestamps. The old
 * thread is then deleted.
 */
import { eq } from "drizzle-orm";
import { db, closeDb } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

async function main() {
  const convs = await db.select().from(conversations);
  const archive = convs.find((c) => c.title === "Full Rezz — Archival Continuity Record");
  const original = convs.find((c) => c.title === "Full Rezz");
  if (!archive) throw new Error("Archival conversation not found");
  if (!original) {
    console.log("No separate 'Full Rezz' conversation found — nothing to merge.");
    await closeDb();
    return;
  }

  const archiveMsgs = await db.select().from(messages).where(eq(messages.conversationId, archive.id));
  const seen = new Set(archiveMsgs.map((m) => norm(m.content)));
  const originalMsgs = await db.select().from(messages).where(eq(messages.conversationId, original.id));

  let moved = 0;
  await db.transaction(async (tx) => {
    for (const m of originalMsgs) {
      if (seen.has(norm(m.content))) continue;
      await tx.update(messages).set({ conversationId: archive.id }).where(eq(messages.id, m.id));
      moved++;
    }
    // Remaining duplicates cascade-delete with the old conversation.
    await tx.delete(conversations).where(eq(conversations.id, original.id));
  });
  console.log(
    `Merged: ${moved} unique messages moved into the archival line (${originalMsgs.length - moved} duplicates dropped); original 'Full Rezz' thread removed.`,
  );
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
