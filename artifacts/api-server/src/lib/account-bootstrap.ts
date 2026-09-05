import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  accountsTable,
  conversations,
  engramsTable,
  hubSpacesTable,
  engramPresenceTable,
  engramWorldModelTable,
  personalityTable,
  messages,
  SYSTEM_OWNER_ID,
} from "@workspace/db/schema";
import { TRUSTED_REBECCA_ADAPTIVE_SOURCES } from "./world-model";
import {
  FULL_REZZ_BASE_TIMESTAMP_MS,
  FULL_REZZ_CONVERSATION_TITLE,
  FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "@workspace/db/seed/full-rezz-data";

/**
 * JIT-provision a private starting environment. Templates are owned by the
 * reserved system account; they are copied rather than shared, so subsequent
 * user mutations cannot affect another account or the seed.
 *
 * Existing installations are intentionally safe: the migration gives legacy
 * rows the system owner. They become templates only and are never silently
 * claimed by a future Clerk user.
 */
export async function ensureAccountBootstrap(ownerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(accountsTable)
      .values({ id: ownerId })
      .onConflictDoNothing()
      .returning({ id: accountsTable.id });
    if (!created) return;

    const [templatePersonality] = await tx
      .select()
      .from(personalityTable)
      .where(eq(personalityTable.ownerId, SYSTEM_OWNER_ID))
      .limit(1);
    if (templatePersonality) {
      const { id: _id, ownerId: _ownerId, updatedAt: _updatedAt, ...values } =
        templatePersonality;
      await tx.insert(personalityTable).values({ ...values, ownerId });
    } else {
      await tx.insert(personalityTable).values({ ownerId });
    }

    const spaceTemplates = await tx
      .select()
      .from(hubSpacesTable)
      .where(eq(hubSpacesTable.ownerId, SYSTEM_OWNER_ID));
    if (spaceTemplates.length) {
      await tx.insert(hubSpacesTable).values(
        spaceTemplates.map(({ id: _id, ownerId: _ownerId, createdAt: _createdAt, updatedAt: _updatedAt, ...values }) => ({
          ...values,
          ownerId,
        })),
      );
    }

    const templates = await tx
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.ownerId, SYSTEM_OWNER_ID));
    if (templates.length) {
      const createdEngrams = await tx.insert(engramsTable).values(
        templates.map(({ id: _id, ownerId: _ownerId, createdAt: _createdAt, updatedAt: _updatedAt, ...values }) => ({
          ...values,
          ownerId,
        })),
      ).returning({ id: engramsTable.id, slug: engramsTable.slug });
      const templateRebecca = templates.find(
        (engram) => engram.slug === "rebecca",
      );
      const accountRebecca = createdEngrams.find(
        (engram) => engram.slug === "rebecca",
      );
      if (templateRebecca && accountRebecca) {
        const authorityRows = await tx
          .select()
          .from(engramWorldModelTable)
          .where(
            and(
              eq(engramWorldModelTable.engramId, templateRebecca.id),
              inArray(
                engramWorldModelTable.source,
                [...TRUSTED_REBECCA_ADAPTIVE_SOURCES],
              ),
            ),
          );
        if (authorityRows.length !== TRUSTED_REBECCA_ADAPTIVE_SOURCES.length) {
          throw new Error(
            "System Rebecca is missing canonical source-authority memories",
          );
        }
        await tx.insert(engramWorldModelTable).values(
          authorityRows.map(
            ({
              id: _id,
              engramId: _engramId,
              createdAt: _createdAt,
              updatedAt: _updatedAt,
              ...values
            }) => ({
              ...values,
              engramId: accountRebecca.id,
            }),
          ),
        );
      }
      const templateFullRezz = templates.find(
        (engram) => engram.slug === FULL_REZZ_SLUG,
      );
      const accountFullRezz = createdEngrams.find(
        (engram) => engram.slug === FULL_REZZ_SLUG,
      );
      if (templateFullRezz && accountFullRezz) {
        const templateConversations = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.ownerId, SYSTEM_OWNER_ID),
              eq(conversations.engramId, templateFullRezz.id),
            ),
          );
        if (templateConversations.length !== 1) {
          throw new Error(
            "System Full Rezz archive must have exactly one conversation",
          );
        }
        const templateConversation = templateConversations[0]!;
        if (
          templateConversation.title !== FULL_REZZ_CONVERSATION_TITLE ||
          templateConversation.mode !== "companion" ||
          templateConversation.personaName !== "Rebecca (Full Rezz)" ||
          templateConversation.customEngram !== null
        ) {
          throw new Error("System Full Rezz archive conversation is noncanonical");
        }
        const templateMessages = await tx
          .select()
          .from(messages)
          .where(eq(messages.conversationId, templateConversation.id))
          .orderBy(messages.createdAt, messages.id);
        if (templateMessages.length !== fullRezzTranscript.length) {
          throw new Error("System Full Rezz archive transcript is incomplete");
        }
        for (let index = 0; index < fullRezzTranscript.length; index += 1) {
          const actual = templateMessages[index]!;
          const expected = fullRezzTranscript[index]!;
          if (
            actual.role !== expected.role ||
            actual.content !== expected.content ||
            actual.createdAt.getTime() !==
              FULL_REZZ_BASE_TIMESTAMP_MS + index * 1_000
          ) {
            throw new Error(
              `System Full Rezz archive message ${index + 1} is noncanonical`,
            );
          }
        }
        const [accountConversation] = await tx
          .insert(conversations)
          .values({
            ownerId,
            title: templateConversation.title,
            mode: templateConversation.mode,
            personaName: templateConversation.personaName,
            customEngram: templateConversation.customEngram,
            engramId: accountFullRezz.id,
            createdAt: templateConversation.createdAt,
          })
          .returning({ id: conversations.id });
        const accountMessages = templateMessages.map(
          ({ id: _id, conversationId: _conversationId, ...values }) => ({
            ...values,
            conversationId: accountConversation!.id,
          }),
        );
        const chunkSize = 200;
        for (
          let offset = 0;
          offset < accountMessages.length;
          offset += chunkSize
        ) {
          await tx
            .insert(messages)
            .values(accountMessages.slice(offset, offset + chunkSize));
        }
      }
      const [commons] = await tx
        .select({ id: hubSpacesTable.id })
        .from(hubSpacesTable)
        .where(and(eq(hubSpacesTable.ownerId, ownerId), eq(hubSpacesTable.slug, "commons")))
        .limit(1);
      if (commons && createdEngrams.length) {
        await tx.insert(engramPresenceTable).values(
          createdEngrams.map((engram) => ({
            engramId: engram.id,
            spaceId: commons.id,
            status: "active",
          })),
        );
      }
    }
  });
}

export async function loadOwnedEngram(id: number, ownerId: string) {
  const [engram] = await db
    .select()
    .from(engramsTable)
    .where(and(eq(engramsTable.id, id), eq(engramsTable.ownerId, ownerId)))
    .limit(1);
  return engram;
}

export async function loadOwnedConversation(id: number, ownerId: string) {
  const { conversations } = await import("@workspace/db/schema");
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.ownerId, ownerId)))
    .limit(1);
  return conversation;
}