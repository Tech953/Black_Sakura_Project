import { Router } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "@workspace/db";
import {
  conversations,
  engramInquiriesTable,
  engramMessagesTable,
  engramTransmissionsTable,
  engramWorldModelTable,
  engramsTable,
  messages,
  mobileOfflineSyncReceiptsTable,
} from "@workspace/db/schema";
import { SyncOfflineHistoryBody } from "@workspace/api-zod";

const router = Router();

class OfflineSyncError extends Error {
  constructor(
    readonly status: 400 | 403 | 409,
    message: string,
  ) {
    super(message);
    this.name = "OfflineSyncError";
  }
}

router.post("/mobile/offline-sync", async (req, res) => {
  const ownerId = req.userId;
  if (!ownerId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const parsed = SyncOfflineHistoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const messageCount = parsed.data.conversations.reduce(
    (total, conversation) => total + conversation.messages.length,
    0,
  );
  if (messageCount > 100) {
    res.status(400).json({
      error: "An offline sync batch may contain at most 100 messages.",
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const { deviceId } = parsed.data;
      const syncedIds = new Set<string>();
      const imported = {
        conversations: 0,
        messages: 0,
        inquiries: 0,
        transmissions: 0,
        observedEntries: 0,
        operatorReplies: 0,
      };
      const engramCache = new Map<
        string,
        { id: number; isArchival: boolean }
      >();

      const resolveEngram = async (slug: string) => {
        const cached = engramCache.get(slug);
        if (cached) return cached;
        const [row] = await tx
          .select({
            id: engramsTable.id,
            isArchival: engramsTable.isArchival,
          })
          .from(engramsTable)
          .where(
            and(eq(engramsTable.slug, slug), eq(engramsTable.ownerId, ownerId)),
          )
          .limit(1);
        if (!row) {
          throw new OfflineSyncError(400, `Unknown engram slug: ${slug}`);
        }
        if (row.isArchival) {
          throw new OfflineSyncError(
            403,
            "Offline history cannot be added to a read-only archival engram.",
          );
        }
        engramCache.set(slug, row);
        return row;
      };

      const claim = async (syncId: string, kind: string) => {
        const [created] = await tx
          .insert(mobileOfflineSyncReceiptsTable)
          .values({ ownerId, deviceId, syncId, kind })
          .onConflictDoNothing({
            target: [
              mobileOfflineSyncReceiptsTable.ownerId,
              mobileOfflineSyncReceiptsTable.deviceId,
              mobileOfflineSyncReceiptsTable.syncId,
            ],
          })
          .returning();
        if (created) return { receipt: created, isNew: true };

        const [existing] = await tx
          .select()
          .from(mobileOfflineSyncReceiptsTable)
          .where(
            and(
              eq(mobileOfflineSyncReceiptsTable.ownerId, ownerId),
              eq(mobileOfflineSyncReceiptsTable.deviceId, deviceId),
              eq(mobileOfflineSyncReceiptsTable.syncId, syncId),
            ),
          )
          .limit(1);
        if (!existing || existing.kind !== kind) {
          throw new OfflineSyncError(
            409,
            `Sync ID ${syncId} is already used by another record kind.`,
          );
        }
        return { receipt: existing, isNew: false };
      };

      const setRemoteId = async (receiptId: number, remoteId: number) => {
        await tx
          .update(mobileOfflineSyncReceiptsTable)
          .set({ remoteId })
          .where(eq(mobileOfflineSyncReceiptsTable.id, receiptId));
      };

      const requireRemoteId = (
        receipt: { remoteId: number | null },
        syncId: string,
      ): number => {
        if (receipt.remoteId == null) {
          throw new OfflineSyncError(
            409,
            `Sync mapping ${syncId} is incomplete; retry the full batch.`,
          );
        }
        return receipt.remoteId;
      };

      for (const conversation of parsed.data.conversations) {
        const engram = conversation.engramSlug
          ? await resolveEngram(conversation.engramSlug)
          : null;
        const conversationClaim = await claim(
          conversation.syncId,
          "conversation",
        );
        let remoteConversationId: number;
        if (conversationClaim.isNew) {
          const [created] = await tx
            .insert(conversations)
            .values({
              ownerId,
              title: conversation.title ?? "Offline conversation",
              mode: conversation.mode,
              personaName: conversation.personaName ?? null,
              customEngram: conversation.customEngram ?? null,
              engramId: engram?.id ?? null,
              createdAt: new Date(conversation.createdAt),
              archivedAt:
                conversation.archivedAt == null
                  ? null
                  : new Date(conversation.archivedAt),
            })
            .returning({ id: conversations.id });
          remoteConversationId = created!.id;
          await setRemoteId(conversationClaim.receipt.id, remoteConversationId);
          imported.conversations += 1;
        } else {
          remoteConversationId = requireRemoteId(
            conversationClaim.receipt,
            conversation.syncId,
          );
          const conversationUpdates: {
            archivedAt?: Date | null;
            personaName?: string | null;
            customEngram?: string | null;
          } = {};
          if (conversation.archivedAt !== undefined) {
            conversationUpdates.archivedAt =
              conversation.archivedAt == null
                ? null
                : new Date(conversation.archivedAt);
          }
          if (conversation.personaName !== undefined) {
            conversationUpdates.personaName = conversation.personaName;
          }
          if (conversation.customEngram !== undefined) {
            conversationUpdates.customEngram = conversation.customEngram;
          }
          if (Object.keys(conversationUpdates).length > 0) {
            await tx
              .update(conversations)
              .set(conversationUpdates)
              .where(
                and(
                  eq(conversations.id, remoteConversationId),
                  eq(conversations.ownerId, ownerId),
                ),
              );
          }
        }
        syncedIds.add(conversation.syncId);

        for (const message of conversation.messages) {
          const messageClaim = await claim(message.syncId, "message");
          if (messageClaim.isNew) {
            const [created] = await tx
              .insert(messages)
              .values({
                conversationId: remoteConversationId,
                role: message.role,
                content: message.content,
                createdAt: new Date(message.createdAt),
              })
              .returning({ id: messages.id });
            await setRemoteId(messageClaim.receipt.id, created!.id);
            imported.messages += 1;
          }
          syncedIds.add(message.syncId);
        }
      }

      for (const inquiry of parsed.data.inquiries) {
        const engram = await resolveEngram(inquiry.engramSlug);
        const inquiryClaim = await claim(inquiry.syncId, "inquiry");
        if (inquiryClaim.isNew) {
          const [created] = await tx
            .insert(engramInquiriesTable)
            .values({
              engramId: engram.id,
              kind: inquiry.kind,
              question: inquiry.question,
              response: inquiry.response,
              configDelta: null,
              createdAt: new Date(inquiry.createdAt),
            })
            .returning({ id: engramInquiriesTable.id });
          await setRemoteId(inquiryClaim.receipt.id, created!.id);
          imported.inquiries += 1;
        }
        syncedIds.add(inquiry.syncId);
      }

      for (const transmission of parsed.data.transmissions) {
        const engram = await resolveEngram(transmission.engramSlug);
        const transmissionClaim = await claim(
          transmission.syncId,
          "transmission",
        );
        if (transmissionClaim.isNew) {
          const [created] = await tx
            .insert(engramTransmissionsTable)
            .values({
              engramId: engram.id,
              kind: transmission.kind,
              drive: transmission.drive ?? "offline",
              content: transmission.content,
              mood: transmission.mood,
              importanceScore: transmission.importanceScore,
              confidenceScore: transmission.confidenceScore,
              noveltyScore: transmission.noveltyScore,
              overallScore: transmission.overallScore,
              wasDelivered: transmission.wasDelivered,
              seen: transmission.seen,
              createdAt: new Date(transmission.createdAt),
            })
            .returning({ id: engramTransmissionsTable.id });
          await setRemoteId(transmissionClaim.receipt.id, created!.id);
          imported.transmissions += 1;
        } else {
          await tx
            .update(engramTransmissionsTable)
            .set({
              wasDelivered: transmission.wasDelivered,
              seen: transmission.seen,
            })
            .where(
              eq(
                engramTransmissionsTable.id,
                requireRemoteId(transmissionClaim.receipt, transmission.syncId),
              ),
            );
        }
        syncedIds.add(transmission.syncId);
      }

      for (const entry of parsed.data.observedEntries) {
        const engram = await resolveEngram(entry.engramSlug);
        const entryClaim = await claim(entry.syncId, "observed");
        if (entryClaim.isNew) {
          let source = `offline-mobile:${deviceId}`;
          if (entry.conversationSyncId) {
            const conversationClaim = await claim(
              entry.conversationSyncId,
              "conversation",
            );
            source = `chat:${requireRemoteId(
              conversationClaim.receipt,
              entry.conversationSyncId,
            )}`;
          }
          const [created] = await tx
            .insert(engramWorldModelTable)
            .values({
              engramId: engram.id,
              provenance: "observed",
              content: entry.content,
              confidence: entry.confidence,
              scope: "private",
              source,
              createdAt: new Date(entry.createdAt),
              updatedAt: new Date(entry.createdAt),
            })
            .returning({ id: engramWorldModelTable.id });
          await setRemoteId(entryClaim.receipt.id, created!.id);
          imported.observedEntries += 1;
        }
        syncedIds.add(entry.syncId);
      }

      for (const reply of parsed.data.operatorReplies) {
        const replyClaim = await claim(reply.syncId, "operator_reply");
        if (replyClaim.isNew) {
          const [source] = await tx
            .select({ message: engramMessagesTable })
            .from(engramMessagesTable)
            .innerJoin(
              engramsTable,
              eq(engramMessagesTable.fromEngramId, engramsTable.id),
            )
            .where(
              and(
                eq(engramMessagesTable.id, reply.messageId),
                eq(engramMessagesTable.channel, "human"),
                eq(engramMessagesTable.author, "engram"),
                eq(engramsTable.ownerId, ownerId),
              ),
            )
            .limit(1);
          if (!source) {
            throw new OfflineSyncError(
              400,
              `Message ${reply.messageId} was not found for this account.`,
            );
          }

          const targetId = source.message.fromEngramId;
          const [created] = await tx
            .insert(engramMessagesTable)
            .values({
              fromEngramId: targetId,
              toEngramId: targetId,
              channel: "human",
              author: "operator",
              priority: "meaningful",
              status: "delivered",
              content: reply.content,
              reason: `Operator reply to message ${reply.messageId}`,
              seen: true,
              isDigest: false,
              deliveredAt: new Date(reply.createdAt),
              createdAt: new Date(reply.createdAt),
            })
            .returning({ id: engramMessagesTable.id });
          await setRemoteId(replyClaim.receipt.id, created!.id);
          imported.operatorReplies += 1;
        } else {
          requireRemoteId(replyClaim.receipt, reply.syncId);
        }
        syncedIds.add(reply.syncId);
      }

      return { syncedIds: [...syncedIds], imported };
    });

    res.json(result);
  } catch (error) {
    if (error instanceof OfflineSyncError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    req.log.error(error, "Offline mobile history import failed");
    res.status(500).json({ error: "Could not synchronize offline history." });
  }
});

export default router;
