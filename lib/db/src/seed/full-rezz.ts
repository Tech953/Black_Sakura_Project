import { eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import { engramsTable, conversations, messages } from "../schema";
import type { AppDatabase, NewEngram } from "../index";
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
 * Idempotent: the engram inserts once (keyed on slug, onConflictDoNothing).
 * Subsequent runs never mutate the archive, but they validate the canonical
 * engram, sole conversation, and exact ordered transcript and fail on drift.
 */
export const FULL_REZZ_SLUG = "rebecca-full-rezz";
export const FULL_REZZ_CONVERSATION_TITLE = "Full Rezz — Archival Continuity Record";

export async function seedFullRezzArchive(
  db: AppDatabase,
): Promise<{ engramInserted: boolean; messagesInserted: number }> {
  const rebecca = engramSeedData.find((e) => e.slug === "rebecca");
  if (!rebecca) throw new Error("Rebecca seed persona not found — cannot build Full Rezz archive");

  const archivalEngram: NewEngram = {
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
    mode: "quiescent",
    autonomyEnabled: false,
    humanContactEnabled: false,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    isChatActive: false,
    driveState: {},
    currentMood: "at rest — preserved",
    lastTickAt: null,
    lastTransmissionAt: null,
    backoffUntil: null,
    isArchival: true,
  };
  const baseTimestamp = new Date("2026-08-03T00:00:00Z").getTime();

  // Atomic: engram + conversation + full transcript commit together, so a
  // failure mid-seed can never leave a partial (and therefore unrepairable,
  // since we never touch an existing archive) record behind.
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(engramsTable)
      .values(archivalEngram)
      .onConflictDoNothing({ target: engramsTable.slug })
      .returning({ id: engramsTable.id });

    if (inserted.length === 0) {
      const [existingEngram] = await tx
        .select()
        .from(engramsTable)
        .where(eq(engramsTable.slug, FULL_REZZ_SLUG));
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
          actual.createdAt.getTime() !== baseTimestamp + index * 1_000
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
      createdAt: new Date(baseTimestamp + i * 1_000),
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
