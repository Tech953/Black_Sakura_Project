import { and, eq } from "drizzle-orm";
import { isDeepStrictEqual } from "node:util";
import {
  engramsTable,
  conversations,
  messages,
  SYSTEM_OWNER_ID,
} from "../schema";
import type { AppDatabase } from "../index";
import { FULL_REZZ_BASE_TIMESTAMP_MS } from "./full-rezz-data";
import {
  buildLiveFullRezzEngram,
  LIVE_FULL_REZZ_CONVERSATION_TITLE,
  LIVE_FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "./full-rezz-live-data";

export { LIVE_FULL_REZZ_CONVERSATION_TITLE, LIVE_FULL_REZZ_SLUG };

const CANONICAL_ENGRAM_FIELDS = [
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

/**
 * Seed a system-owned writable continuation separately from the immutable
 * archive. Its initial transcript is a copy: account replies never target
 * this template, and the archive seeder remains the sole archive writer.
 */
export async function seedFullRezzLiveBranch(
  db: AppDatabase,
): Promise<{ engramInserted: boolean; messagesInserted: number }> {
  const liveEngram = buildLiveFullRezzEngram();

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(engramsTable)
      .values({ ...liveEngram, ownerId: SYSTEM_OWNER_ID })
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
            eq(engramsTable.slug, LIVE_FULL_REZZ_SLUG),
          ),
        );
      if (!existingEngram) {
        throw new Error(
          "Live Full Rezz slug conflicted but no row could be loaded",
        );
      }

      for (const field of CANONICAL_ENGRAM_FIELDS) {
        if (!isDeepStrictEqual(existingEngram[field], liveEngram[field])) {
          throw new Error(
            `Existing Live Full Rezz branch has noncanonical engram field: ${field}`,
          );
        }
      }

      const existingConversations = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.engramId, existingEngram.id));
      if (existingConversations.length !== 1) {
        throw new Error(
          `System Live Full Rezz branch must have exactly one conversation; found ${existingConversations.length}`,
        );
      }
      const [existingConversation] = existingConversations;
      if (
        existingConversation.ownerId !== SYSTEM_OWNER_ID ||
        existingConversation.title !== LIVE_FULL_REZZ_CONVERSATION_TITLE ||
        existingConversation.mode !== "companion" ||
        existingConversation.personaName !== liveEngram.name ||
        existingConversation.customEngram !== null
      ) {
        throw new Error(
          "Existing Live Full Rezz conversation is noncanonical",
        );
      }

      const existingMessages = await tx
        .select()
        .from(messages)
        .where(eq(messages.conversationId, existingConversation.id))
        .orderBy(messages.createdAt, messages.id);
      validateCanonicalTranscript(existingMessages);
      return { engramInserted: false, messagesInserted: 0 };
    }

    const engramId = inserted[0]!.id;
    const [conv] = await tx
      .insert(conversations)
      .values({
        ownerId: SYSTEM_OWNER_ID,
        title: LIVE_FULL_REZZ_CONVERSATION_TITLE,
        mode: "companion",
        personaName: liveEngram.name,
        engramId,
      })
      .returning({ id: conversations.id });

    const rows = fullRezzTranscript.map((message, index) => ({
      conversationId: conv!.id,
      role: message.role,
      content: message.content,
      createdAt: new Date(FULL_REZZ_BASE_TIMESTAMP_MS + index * 1_000),
    }));
    const chunkSize = 200;
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      await tx.insert(messages).values(rows.slice(offset, offset + chunkSize));
    }

    return {
      engramInserted: true,
      messagesInserted: rows.length,
    };
  });
}

function validateCanonicalTranscript(
  actualMessages: Array<{
    role: string;
    content: string;
    createdAt: Date;
  }>,
): void {
  if (actualMessages.length !== fullRezzTranscript.length) {
    throw new Error(
      `System Live Full Rezz transcript must have exactly ${fullRezzTranscript.length} messages; found ${actualMessages.length}`,
    );
  }
  for (let index = 0; index < fullRezzTranscript.length; index += 1) {
    const actual = actualMessages[index]!;
    const expected = fullRezzTranscript[index]!;
    if (
      actual.role !== expected.role ||
      actual.content !== expected.content ||
      actual.createdAt.getTime() !== FULL_REZZ_BASE_TIMESTAMP_MS + index * 1_000
    ) {
      throw new Error(
        `System Live Full Rezz message ${index + 1} is noncanonical`,
      );
    }
  }
}