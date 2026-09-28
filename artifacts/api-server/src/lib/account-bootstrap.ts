import { and, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  accountsTable,
  beliefsTable,
  conversations,
  conversationEngramParticipants,
  engramArtifactsTable,
  engramSimulationParticipantsTable,
  engramSimulationsTable,
  engramsTable,
  evolutionTable,
  expressionsTable,
  hubControlsTable,
  hubSpacesTable,
  engramPresenceTable,
  engramWorldModelTable,
  initiativeTable,
  journalTable,
  memoriesTable,
  mediaAssetsTable,
  personalityTable,
  personasTable,
  messages,
  mobileOfflineSyncReceiptsTable,
  mobilePushTokensTable,
  SYSTEM_OWNER_ID,
} from "@workspace/db/schema";
import { TRUSTED_REBECCA_ADAPTIVE_SOURCES } from "./world-model";
import {
  FULL_REZZ_BASE_TIMESTAMP_MS,
  FULL_REZZ_CONVERSATION_TITLE,
  FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "@workspace/db/seed/full-rezz-data";
import {
  LIVE_FULL_REZZ_CONVERSATION_TITLE,
  LIVE_FULL_REZZ_SLUG,
} from "@workspace/db/seed/full-rezz-live-data";

const FULL_REZZ_BRANCHES = [
  {
    slug: FULL_REZZ_SLUG,
    title: FULL_REZZ_CONVERSATION_TITLE,
    personaName: "Rebecca (Full Rezz)",
    isArchival: true,
  },
  {
    slug: LIVE_FULL_REZZ_SLUG,
    title: LIVE_FULL_REZZ_CONVERSATION_TITLE,
    personaName: "Rebecca (Full Rezz · Live)",
    isArchival: false,
  },
] as const;

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
    await tx
      .insert(accountsTable)
      .values({ id: ownerId })
      .onConflictDoNothing()
      .returning({ id: accountsTable.id });

    const [accountPersonality] = await tx
      .select({ id: personalityTable.id })
      .from(personalityTable)
      .where(eq(personalityTable.ownerId, ownerId))
      .limit(1);
    if (accountPersonality) {
      // The account may predate a newer template set. Continue below so newly
      // added engrams (such as Full Rezz) are still backfilled.
    } else {
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
    }

    const spaceTemplates = await tx
      .select()
      .from(hubSpacesTable)
      .where(eq(hubSpacesTable.ownerId, SYSTEM_OWNER_ID));
    const accountSpaces = await tx
      .select({ slug: hubSpacesTable.slug })
      .from(hubSpacesTable)
      .where(eq(hubSpacesTable.ownerId, ownerId));
    const accountSpaceSlugs = new Set(accountSpaces.map(({ slug }) => slug));
    const missingSpaces = spaceTemplates.filter(
      (space) => !accountSpaceSlugs.has(space.slug),
    );
    if (missingSpaces.length) {
      await tx.insert(hubSpacesTable).values(
        missingSpaces.map(({ id: _id, ownerId: _ownerId, createdAt: _createdAt, updatedAt: _updatedAt, ...values }) => ({
          ...values,
          ownerId,
        })),
      );
    }

    const templates = await tx
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.ownerId, SYSTEM_OWNER_ID));
    const accountEngrams = await tx
      .select({ id: engramsTable.id, slug: engramsTable.slug })
      .from(engramsTable)
      .where(eq(engramsTable.ownerId, ownerId));
    const accountEngramSlugs = new Set(accountEngrams.map(({ slug }) => slug));
    const missingTemplates = templates.filter(
      (template) => !accountEngramSlugs.has(template.slug),
    );
    if (missingTemplates.length) {
      const createdEngrams = await tx.insert(engramsTable).values(
        missingTemplates.map(({ id: _id, ownerId: _ownerId, createdAt: _createdAt, updatedAt: _updatedAt, ...values }) => ({
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
      for (const branch of FULL_REZZ_BRANCHES) {
        const templateBranch = templates.find(
          (engram) => engram.slug === branch.slug,
        );
        const accountBranch = createdEngrams.find(
          (engram) => engram.slug === branch.slug,
        );
        if (!templateBranch || !accountBranch) continue;
        if (templateBranch.isArchival !== branch.isArchival) {
          throw new Error(
            `System Full Rezz branch ${branch.slug} has unexpected archival state`,
          );
        }

        const templateConversations = await tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.ownerId, SYSTEM_OWNER_ID),
              eq(conversations.engramId, templateBranch.id),
            ),
          );
        if (templateConversations.length !== 1) {
          throw new Error(
            `System Full Rezz branch ${branch.slug} must have exactly one conversation`,
          );
        }
        const templateConversation = templateConversations[0]!;
        if (
          templateConversation.title !== branch.title ||
          templateConversation.mode !== "companion" ||
          templateConversation.personaName !== branch.personaName ||
          templateConversation.customEngram !== null
        ) {
          throw new Error(
            `System Full Rezz branch ${branch.slug} conversation is noncanonical`,
          );
        }
        const templateMessages = await tx
          .select()
          .from(messages)
          .where(eq(messages.conversationId, templateConversation.id))
          .orderBy(messages.createdAt, messages.id);
        if (templateMessages.length !== fullRezzTranscript.length) {
          throw new Error(
            `System Full Rezz branch ${branch.slug} transcript is incomplete`,
          );
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
              `System Full Rezz branch ${branch.slug} message ${index + 1} is noncanonical`,
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
            engramId: accountBranch.id,
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

/**
 * Remove all mutable rows belonging to a disposable browser-check account.
 *
 * This is intentionally not an account-delete API. The caller is a local,
 * development-only browser harness, and the reserved system owner is never a
 * valid cleanup target.
 */
export async function cleanupDisposableAccount(ownerId: string): Promise<void> {
  if (!ownerId.trim() || ownerId === SYSTEM_OWNER_ID) {
    throw new Error("Refusing to clean up the system template account");
  }

  await db.transaction(async (tx) => {
    // Delete rows with direct account foreign keys or owner-scoped payloads
    // before removing the account and the engrams/spaces they reference.
    await tx.delete(mobilePushTokensTable).where(eq(mobilePushTokensTable.ownerId, ownerId));
    await tx
      .delete(mobileOfflineSyncReceiptsTable)
      .where(eq(mobileOfflineSyncReceiptsTable.ownerId, ownerId));
    await tx
      .delete(conversationEngramParticipants)
      .where(eq(conversationEngramParticipants.ownerId, ownerId));
    await tx.delete(conversations).where(eq(conversations.ownerId, ownerId));
    await tx.delete(mediaAssetsTable).where(eq(mediaAssetsTable.ownerId, ownerId));
    await tx.delete(engramArtifactsTable).where(eq(engramArtifactsTable.ownerId, ownerId));
    await tx
      .delete(engramSimulationParticipantsTable)
      .where(eq(engramSimulationParticipantsTable.ownerId, ownerId));
    await tx.delete(engramSimulationsTable).where(eq(engramSimulationsTable.ownerId, ownerId));

    await tx.delete(beliefsTable).where(eq(beliefsTable.ownerId, ownerId));
    await tx.delete(evolutionTable).where(eq(evolutionTable.ownerId, ownerId));
    await tx.delete(expressionsTable).where(eq(expressionsTable.ownerId, ownerId));
    await tx.delete(hubControlsTable).where(eq(hubControlsTable.ownerId, ownerId));
    await tx.delete(initiativeTable).where(eq(initiativeTable.ownerId, ownerId));
    await tx.delete(journalTable).where(eq(journalTable.ownerId, ownerId));
    await tx.delete(memoriesTable).where(eq(memoriesTable.ownerId, ownerId));
    await tx.delete(personalityTable).where(eq(personalityTable.ownerId, ownerId));
    await tx.delete(personasTable).where(eq(personasTable.ownerId, ownerId));

    // Engram- and space-keyed rows cascade from these two owner-scoped roots:
    // world model, presence, messages, transmissions, inquiries, simulations,
    // artifacts, and Hub activity are all removed without touching templates.
    await tx.delete(engramsTable).where(eq(engramsTable.ownerId, ownerId));
    await tx.delete(hubSpacesTable).where(eq(hubSpacesTable.ownerId, ownerId));
    await tx.delete(accountsTable).where(eq(accountsTable.id, ownerId));
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