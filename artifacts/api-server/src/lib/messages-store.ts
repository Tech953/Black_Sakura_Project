import { db } from "@workspace/db";
import {
  engramMessagesTable,
  engramsTable,
  SYSTEM_OWNER_ID,
} from "@workspace/db/schema";
import type {
  EngramMessage,
  EngramMessageChannel,
  NewEngramMessage,
} from "@workspace/db";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or } from "drizzle-orm";

const MESSAGES_DEFAULT_LIMIT = 50;
const MESSAGES_MAX_LIMIT = 500;
const DIGEST_BATCH_LIMIT = 25;
const DIGEST_PREVIEW_LIMIT = 280;

/** Statuses that count as an actual contact reaching the human (for rate limiting). */
const CONTACTED_STATUSES = ["delivered", "queued", "digest"] as const;

/**
 * Load bus messages, newest first. Filter by channel when given (engram-to-engram
 * vs human-directed). Limit is clamped to a sane ceiling.
 */
export async function loadMessages(
  ownerId: string,
  opts: {
    channel?: EngramMessageChannel;
    limit?: number;
    before?: Date;
    beforeId?: number;
  } = {},
): Promise<EngramMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? MESSAGES_DEFAULT_LIMIT, 1), MESSAGES_MAX_LIMIT);
  const conditions = [eq(engramsTable.ownerId, ownerId)];
  if (opts.channel) conditions.push(eq(engramMessagesTable.channel, opts.channel));
  if (opts.before) {
    const beforeCondition =
      opts.beforeId == null
        ? lt(engramMessagesTable.createdAt, opts.before)
        : or(
            lt(engramMessagesTable.createdAt, opts.before),
            and(
              eq(engramMessagesTable.createdAt, opts.before),
              lt(engramMessagesTable.id, opts.beforeId),
            ),
          );
    if (beforeCondition) conditions.push(beforeCondition);
  }
  const rows = await db
    .select({ message: engramMessagesTable })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(and(...conditions))
    .orderBy(desc(engramMessagesTable.createdAt), desc(engramMessagesTable.id))
    .limit(limit);
  return rows.map((row) => row.message);
}

/**
 * Load recent engram-channel messages that occurred inside one space, newest first.
 * Used by the commons turn-taking logic to derive per-engram "last spoke" times and
 * to build the short transcript fed into the next conversation turn. Both the
 * sender and any recipient must belong to the requested owner.
 */
export async function loadSpaceMessages(
  ownerId: string,
  spaceId: number,
  limit: number,
): Promise<EngramMessage[]> {
  const rows = await db
    .select({ message: engramMessagesTable })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(
      and(
        eq(engramsTable.ownerId, ownerId),
        eq(engramMessagesTable.spaceId, spaceId),
        eq(engramMessagesTable.channel, "engram"),
        or(
          isNull(engramMessagesTable.toEngramId),
          inArray(
            engramMessagesTable.toEngramId,
            db
              .select({ id: engramsTable.id })
              .from(engramsTable)
              .where(eq(engramsTable.ownerId, ownerId)),
          ),
        ),
      ),
    )
    .orderBy(desc(engramMessagesTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), MESSAGES_MAX_LIMIT));
  return rows.map((row) => row.message);
}

/** Insert a single bus message (engram turn or human-contact attempt, including refusals). */
export async function recordMessage(ownerId: string, entry: NewEngramMessage): Promise<EngramMessage> {
  const [source] = await db
    .select({ id: engramsTable.id })
    .from(engramsTable)
    .where(and(eq(engramsTable.id, entry.fromEngramId), eq(engramsTable.ownerId, ownerId)));
  if (!source) throw new Error("Engram not found");
  if (entry.toEngramId != null) {
    const [recipient] = await db
      .select({ id: engramsTable.id })
      .from(engramsTable)
      .where(and(eq(engramsTable.id, entry.toEngramId), eq(engramsTable.ownerId, ownerId)));
    if (!recipient) throw new Error("Engram not found");
  }
  const [row] = await db.insert(engramMessagesTable).values(entry).returning();
  return row;
}

/**
 * Mark the given human-channel message ids as seen by the operator. The channel
 * predicate keeps this scoped to the terminal: commons/audit messages can never
 * be flipped to seen through this path even if their ids are supplied.
 */
export async function markMessagesSeen(ownerId: string, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(engramMessagesTable)
    .set({ seen: true })
    .where(
      and(
        inArray(engramMessagesTable.id, ids),
        eq(engramMessagesTable.channel, "human"),
        inArray(
          engramMessagesTable.fromEngramId,
          db
            .select({ id: engramsTable.id })
            .from(engramsTable)
            .where(eq(engramsTable.ownerId, ownerId)),
        ),
      ),
    )
    .returning({ id: engramMessagesTable.id });
  return rows.length;
}

/**
 * Count an engram's human-contact attempts that actually reached the operator
 * (delivered/queued/digest source attempts — refusals and generated summaries
 * excluded) within the trailing hour and day. Used by the rate-limit policy;
 * pure decision logic lives in engram-policy.ts.
 */
export async function recentHumanCounts(
  ownerId: string,
  fromEngramId: number,
  now: Date = new Date(),
): Promise<{ hour: number; day: number }> {
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ createdAt: engramMessagesTable.createdAt })
    .from(engramMessagesTable)
    .where(
      and(
        eq(engramMessagesTable.fromEngramId, fromEngramId),
        inArray(
          engramMessagesTable.fromEngramId,
          db
            .select({ id: engramsTable.id })
            .from(engramsTable)
            .where(and(eq(engramsTable.id, fromEngramId), eq(engramsTable.ownerId, ownerId))),
        ),
        eq(engramMessagesTable.channel, "human"),
        eq(engramMessagesTable.author, "engram"),
        eq(engramMessagesTable.isDigest, false),
        inArray(engramMessagesTable.status, [...CONTACTED_STATUSES]),
        gte(engramMessagesTable.createdAt, dayAgo),
      ),
    );

  let hour = 0;
  for (const r of rows) {
    if (r.createdAt >= hourAgo) hour += 1;
  }
  return { hour, day: rows.length };
}

export interface RecentOperatorReply {
  id: number;
  content: string;
  acknowledgedAt: Date | null;
}

/** Load the operator's recent replies so the next autonomous turn can acknowledge them. */
export async function loadRecentOperatorReplyRows(
  ownerId: string,
  engramId: number,
  limit = 5,
): Promise<RecentOperatorReply[]> {
  const rows = await db
    .select({
      id: engramMessagesTable.id,
      content: engramMessagesTable.content,
      acknowledgedAt: engramMessagesTable.acknowledgedAt,
    })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(
      and(
        eq(engramsTable.ownerId, ownerId),
        eq(engramMessagesTable.fromEngramId, engramId),
        eq(engramMessagesTable.channel, "human"),
        eq(engramMessagesTable.author, "operator"),
      ),
    )
    .orderBy(desc(engramMessagesTable.createdAt))
    .limit(Math.min(Math.max(limit, 1), 10));
  return rows;
}

export async function loadRecentOperatorReplies(
  ownerId: string,
  engramId: number,
  limit = 5,
): Promise<string[]> {
  const rows = await loadRecentOperatorReplyRows(ownerId, engramId, limit);
  return rows.map((row) => row.content);
}

/**
 * Mark only the owner-scoped operator replies that were included in a successful
 * engram prompt. The text remains immutable; acknowledgement is an audit timestamp.
 */
export async function markOperatorRepliesAcknowledged(
  ownerId: string,
  engramId: number,
  ids: number[],
  now: Date = new Date(),
): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await db
    .update(engramMessagesTable)
    .set({ acknowledgedAt: now })
    .where(
      and(
        inArray(engramMessagesTable.id, ids),
        eq(engramMessagesTable.fromEngramId, engramId),
        eq(engramMessagesTable.channel, "human"),
        eq(engramMessagesTable.author, "operator"),
        isNull(engramMessagesTable.acknowledgedAt),
        inArray(
          engramMessagesTable.fromEngramId,
          db
            .select({ id: engramsTable.id })
            .from(engramsTable)
            .where(and(eq(engramsTable.id, engramId), eq(engramsTable.ownerId, ownerId))),
        ),
      ),
    )
    .returning({ id: engramMessagesTable.id });
  return rows.length;
}

/**
 * Persist an operator reply to an engram-authored human message. The source
 * lookup and owner check happen together so an id from another account cannot
 * be used to address an engram.
 */
export async function replyToMessage(
  ownerId: string,
  messageId: number,
  content: string,
  now: Date = new Date(),
): Promise<EngramMessage | null> {
  const [source] = await db
    .select({ message: engramMessagesTable })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(
      and(
        eq(engramMessagesTable.id, messageId),
        eq(engramsTable.ownerId, ownerId),
        eq(engramMessagesTable.channel, "human"),
        eq(engramMessagesTable.author, "engram"),
      ),
    );
  if (!source) return null;

  const targetId = source.message.fromEngramId;
  const [reply] = await db
    .insert(engramMessagesTable)
    .values({
      fromEngramId: targetId,
      toEngramId: targetId,
      channel: "human",
      author: "operator",
      priority: "meaningful",
      status: "delivered",
      content,
      reason: `Operator reply to message ${messageId}`,
      seen: true,
      isDigest: false,
      deliveredAt: now,
    })
    .returning();
  return reply;
}

/**
 * Collapse unseen social-priority contact into one auditable operator message.
 * Source rows keep their original digest status for history, while digestedAt
 * makes the operation retry-safe and the isDigest marker distinguishes the
 * summary from an ordinary contact in the terminal.
 */
export async function createHumanDigest(
  ownerId: string,
  now: Date = new Date(),
): Promise<EngramMessage | null> {
  return db.transaction(async (tx) => {
    const pending = await tx
      .select({
        message: engramMessagesTable,
        engramName: engramsTable.name,
      })
      .from(engramMessagesTable)
      .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
      .where(
        and(
          eq(engramsTable.ownerId, ownerId),
          eq(engramMessagesTable.channel, "human"),
          eq(engramMessagesTable.status, "digest"),
          eq(engramMessagesTable.seen, false),
          eq(engramMessagesTable.isDigest, false),
          isNull(engramMessagesTable.digestedAt),
        ),
      )
      .orderBy(asc(engramMessagesTable.createdAt), asc(engramMessagesTable.id))
      .limit(DIGEST_BATCH_LIMIT)
      .for("update", { skipLocked: true });

    if (pending.length === 0) return null;

    const preview = pending
      .map(({ message, engramName }) => {
        const content = message.content.trim();
        const excerpt =
          content.length > DIGEST_PREVIEW_LIMIT
            ? `${content.slice(0, DIGEST_PREVIEW_LIMIT - 1)}…`
            : content;
        return `• ${engramName}: ${excerpt}`;
      })
      .join("\n");
    const sourceIds = pending.map(({ message }) => message.id);
    const first = pending[0].message;
    const [summary] = await tx
      .insert(engramMessagesTable)
      .values({
        fromEngramId: first.fromEngramId,
        toEngramId: null,
        spaceId: null,
        channel: "human",
        priority: "social",
        status: "digest",
        content: `Periodic digest · ${pending.length} low-priority message${
          pending.length === 1 ? "" : "s"
        }\n${preview}`,
        reason: "Bundled from unseen social-priority contact",
        seen: false,
        isDigest: true,
        deliveredAt: now,
      })
      .returning();

    await tx
      .update(engramMessagesTable)
      .set({ digestedAt: now })
      .where(
        and(
          inArray(engramMessagesTable.id, sourceIds),
          isNull(engramMessagesTable.digestedAt),
        ),
      );

    return summary;
  });
}

/** Find owners whose held social contact still needs a digest pass. */
export async function listPendingHumanDigestOwners(): Promise<string[]> {
  const rows = await db
    .selectDistinct({ ownerId: engramsTable.ownerId })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(
      and(
        ne(engramsTable.ownerId, SYSTEM_OWNER_ID),
        eq(engramMessagesTable.channel, "human"),
        eq(engramMessagesTable.status, "digest"),
        eq(engramMessagesTable.seen, false),
        eq(engramMessagesTable.isDigest, false),
        isNull(engramMessagesTable.digestedAt),
      ),
    );
  return rows.map((row) => row.ownerId);
}
