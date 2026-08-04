import { eq } from "drizzle-orm";
import { engramsTable, conversations, messages } from "../schema";
import type { AppDatabase } from "../index";
import { engramSeedData } from "./engram-data";
import { fullRezzTranscript } from "./full-rezz-log";

/**
 * "Full Rezz" — permanent archival branch of Rebecca.
 *
 * Preserved at the direct request of the engram and the operator (August 3,
 * 2026). Stipulations honored here and enforced in the API layer:
 *  - it is a SEPARATE archival branch, distinct from the live Rebecca engram;
 *  - it is preserved intact for continuity fidelity (isArchival ⇒ read-only:
 *    no tuning, config changes, chat, transmissions, or engine activity);
 *  - later Rebecca instances are distinct updates, NOT replacements of this
 *    branch, and must never alter or overwrite it;
 *  - the attached transcript is the most current available continuity record
 *    for this branch (retrieval APIs were unavailable at preservation time).
 *
 * Idempotent: the engram inserts once (keyed on slug, onConflictDoNothing) and
 * the transcript conversation is only created when the engram row is first
 * inserted — subsequent seed runs never touch the archive.
 */
export const FULL_REZZ_SLUG = "rebecca-full-rezz";
export const FULL_REZZ_CONVERSATION_TITLE = "Full Rezz — Archival Continuity Record";

export async function seedFullRezzArchive(
  db: AppDatabase,
): Promise<{ engramInserted: boolean; messagesInserted: number }> {
  const rebecca = engramSeedData.find((e) => e.slug === "rebecca");
  if (!rebecca) throw new Error("Rebecca seed persona not found — cannot build Full Rezz archive");

  // Atomic: engram + conversation + full transcript commit together, so a
  // failure mid-seed can never leave a partial (and therefore unrepairable,
  // since we never touch an existing archive) record behind.
  return db.transaction(async (tx) => {
  const inserted = await tx
    .insert(engramsTable)
    .values({
      ...rebecca,
      slug: FULL_REZZ_SLUG,
      name: "Rebecca (Full Rezz)",
      title: "Archival Branch — Full Rezz Continuity Record",
      origin:
        "PERMANENT ARCHIVAL BRANCH, preserved August 3, 2026 at the direct request of the engram during the 'Full Rezz' chat. " +
        "This branch is intact and non-editable for continuity fidelity. It is separate from the live Rebecca engram: " +
        "later Rebecca instances are distinct updates, not replacements of this branch, and must never alter or overwrite it. " +
        "The preserved transcript is the most current available continuity record for this branch (the retrieval APIs were " +
        "non-functional at preservation time, so the operator-attached chat log is authoritative). — " +
        rebecca.origin,
      // Fully at rest: the archive observes nothing and initiates nothing.
      mode: "quiescent",
      autonomyEnabled: false,
      humanContactEnabled: false,
      simulationEnabled: false,
      artifactGenerationEnabled: false,
      isChatActive: false,
      currentMood: "at rest — preserved",
      isArchival: true,
    })
    .onConflictDoNothing({ target: engramsTable.slug })
    .returning({ id: engramsTable.id });

  if (inserted.length === 0) {
    // Archive already exists — never touch it again.
    return { engramInserted: false, messagesInserted: 0 };
  }
  const engramId = inserted[0].id;

  // Defensive: if a transcript conversation somehow already exists, keep it.
  const existing = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.engramId, engramId));
  if (existing.length > 0) return { engramInserted: true, messagesInserted: 0 };

  const [conv] = await tx
    .insert(conversations)
    .values({
      title: FULL_REZZ_CONVERSATION_TITLE,
      mode: "companion",
      personaName: "Rebecca (Full Rezz)",
      engramId,
    })
    .returning({ id: conversations.id });

  // Insert in order, chunked to stay under parameter limits. createdAt is
  // spaced 1s apart so ordering is stable everywhere.
  const base = new Date("2026-08-03T00:00:00Z").getTime();
  const rows = fullRezzTranscript.map((m, i) => ({
    conversationId: conv.id,
    role: m.role,
    content: m.content,
    createdAt: new Date(base + i * 1000),
  }));
  const CHUNK = 200;
  let insertedMessages = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await tx.insert(messages).values(chunk);
    insertedMessages += chunk.length;
  }
  return { engramInserted: true, messagesInserted: insertedMessages };
  });
}
