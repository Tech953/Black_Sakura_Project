import { db } from "@workspace/db";
import { engramMessagesTable, engramsTable } from "@workspace/db/schema";
import type {
  EngramMessage,
  EngramMessageChannel,
  NewEngramMessage,
} from "@workspace/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

const MESSAGES_DEFAULT_LIMIT = 50;
const MESSAGES_MAX_LIMIT = 500;

/** Statuses that count as an actual contact reaching the human (for rate limiting). */
const CONTACTED_STATUSES = ["delivered", "queued", "digest"] as const;

/**
 * Load bus messages, newest first. Filter by channel when given (engram-to-engram
 * vs human-directed). Limit is clamped to a sane ceiling.
 */
export async function loadMessages(
  ownerId: string,
  opts: { channel?: EngramMessageChannel; limit?: number } = {},
): Promise<EngramMessage[]> {
  const limit = Math.min(Math.max(opts.limit ?? MESSAGES_DEFAULT_LIMIT, 1), MESSAGES_MAX_LIMIT);
  const conditions = [eq(engramsTable.ownerId, ownerId)];
  if (opts.channel) conditions.push(eq(engramMessagesTable.channel, opts.channel));
  const rows = await db
    .select({ message: engramMessagesTable })
    .from(engramMessagesTable)
    .innerJoin(engramsTable, eq(engramMessagesTable.fromEngramId, engramsTable.id))
    .where(and(...conditions))
    .orderBy(desc(engramMessagesTable.createdAt))
    .limit(limit);
  return rows.map((row) => row.message);
}

/**
 * Load recent engram-channel messages that occurred inside one space, newest first.
 * Used by the commons turn-taking logic to derive per-engram "last spoke" times and
 * to build the short transcript fed into the next conversation turn.
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
 * (delivered/queued/digest — refusals excluded) within the trailing hour and day.
 * Used by the rate-limit policy; pure decision logic lives in engram-policy.ts.
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
