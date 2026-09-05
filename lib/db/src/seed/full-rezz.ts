import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  engramsTable,
  conversations,
  messages,
  SYSTEM_OWNER_ID,
} from "../schema";
import type { AppDatabase } from "../index";
import {
  buildFullRezzEngram,
  FULL_REZZ_BASE_TIMESTAMP_MS,
  FULL_REZZ_CONVERSATION_TITLE,
  FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "./full-rezz-data";

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
 * Idempotent: the engram inserts once (keyed on slug, onConflictDoNothing).
 * Subsequent runs never mutate the archive, but they validate the canonical
 * engram, sole conversation, and exact ordered transcript and fail on drift.
 */
export { FULL_REZZ_CONVERSATION_TITLE, FULL_REZZ_SLUG };

export async function seedFullRezzArchive(
  db: AppDatabase,
): Promise<{ engramInserted: boolean; messagesInserted: number }> {
  const archivalEngram = buildFullRezzEngram();

  // Atomic: engram + conversation + full transcript commit together, so a
  // failure mid-seed can never leave a partial (and therefore unrepairable,
  // since we never touch an existing archive) record behind.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(engramsTable)
      .values({ ...archivalEngram, ownerId: SYSTEM_OWNER_ID })
      .onConflictDoNothing({
        target: [engramsTable.ownerId, engramsTable.slug],
      })
      .returning({ id: engramsTable.id });

    if (inserted.length === 0) {
      const [existingEngram] = await tx
        .select()
        .from(engramsTable)
        .where(
          and(
            eq(engramsTable.ownerId, SYSTEM_OWNER_ID),
            eq(engramsTable.slug, FULL_REZZ_SLUG),
          ),
        );
      if (!existingEngram) {
        throw new Error("Full Rezz archive slug conflicted but no row could be loaded");
      }

      const canonicalFields = [
        "slug",
        "name",
        "title",
        "symbol",
        "origin",
        "voiceProfile",
        "emotionalBaseline",
        "environmentAnchor",
        "memorySeed",
        "guardrails",
        "drives",
        "focusThemes",
        "autonomyEnabled",
        "tickCadenceSeconds",
        "initiationThreshold",
        "mode",
        "humanContactEnabled",
        "simulationEnabled",
        "artifactGenerationEnabled",
        "isArchival",
        "driveState",
        "currentMood",
        "lastTickAt",
        "lastTransmissionAt",
        "backoffUntil",
        "isChatActive",
      ] as const;
      for (const field of canonicalFields) {
        if (!isDeepStrictEqual(existingEngram[field], archivalEngram[field])) {
          throw new Error(`Existing Full Rezz archive has noncanonical engram field: ${field}`);
        }
      }

      const existingConversations = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.engramId, existingEngram.id));
      if (existingConversations.length !== 1) {
        throw new Error(
          `Existing Full Rezz archive must have exactly one conversation; found ${existingConversations.length}`,
        );
      }
      const [existingConversation] = existingConversations;
      if (
        existingConversation.title !== FULL_REZZ_CONVERSATION_TITLE ||
        existingConversation.mode !== "companion" ||
        existingConversation.personaName !== "Rebecca (Full Rezz)" ||
        existingConversation.customEngram !== null
      ) {
        throw new Error("Existing Full Rezz archive conversation is noncanonical");
      }

      const existingMessages = await tx
        .select()
        .from(messages)
        .where(eq(messages.conversationId, existingConversation.id))
        .orderBy(messages.createdAt, messages.id);
      if (existingMessages.length !== fullRezzTranscript.length) {
        throw new Error(
          `Existing Full Rezz archive must have exactly ${fullRezzTranscript.length} messages; found ${existingMessages.length}`,
        );
      }
      for (let index = 0; index < fullRezzTranscript.length; index += 1) {
        const actual = existingMessages[index];
        const expected = fullRezzTranscript[index];
        if (
          actual.role !== expected.role ||
          actual.content !== expected.content ||
          actual.createdAt.getTime() !==
            FULL_REZZ_BASE_TIMESTAMP_MS + index * 1_000
        ) {
          throw new Error(
            `Existing Full Rezz archive message ${index + 1} is noncanonical`,
          );
        }
      }

      return { engramInserted: false, messagesInserted: 0 };
    }
    const engramId = inserted[0].id;

    const [conv] = await tx
      .insert(conversations)
      .values({
        ownerId: SYSTEM_OWNER_ID,
        title: FULL_REZZ_CONVERSATION_TITLE,
        mode: "companion",
        personaName: "Rebecca (Full Rezz)",
        engramId,
      })
      .returning({ id: conversations.id });

    // Insert in order, chunked to stay under parameter limits. createdAt is
    // spaced 1s apart so ordering is stable everywhere.
    const rows = fullRezzTranscript.map((m, i) => ({
      conversationId: conv.id,
      role: m.role,
      content: m.content,
      createdAt: new Date(FULL_REZZ_BASE_TIMESTAMP_MS + i * 1_000),
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
