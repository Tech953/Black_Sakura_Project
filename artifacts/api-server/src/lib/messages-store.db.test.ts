import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Use real PostgreSQL semantics through PGlite so FOR UPDATE SKIP LOCKED and
// the digest transaction are exercised instead of the shared route harness.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  closeDb,
  db,
  engramMessagesTable,
  engramsTable,
  ensureDatabaseReady,
} from "@workspace/db";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import {
  createHumanDigest,
  loadRecentOperatorReplyRows,
  markOperatorRepliesAcknowledged,
  replyToMessage,
} from "./messages-store";

const OWNER_ID = "messages-store-digest-concurrency-owner";
const OTHER_OWNER_ID = "messages-store-other-owner";
const ready = ensureDatabaseReady({ seed: false });
let engramSequence = 0;

beforeEach(async () => {
  await ready;
  await db.delete(engramMessagesTable);
  await db.delete(engramsTable);
});

afterAll(async () => {
  await closeDb();
});

async function insertEngram(ownerId = OWNER_ID): Promise<number> {
  engramSequence += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId,
      slug: `digest-concurrency-${engramSequence}`,
      name: "Digest Concurrency",
      title: "Digest concurrency test",
      symbol: "D",
      origin: "test",
      voiceProfile: {
        speechStyle: "",
        formatting: "",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "" },
      environmentAnchor: {
        name: "",
        description: "",
        locations: [],
        items: [],
        ambient: "",
      },
      memorySeed: { relationship: "", facts: [], summary: "" },
      guardrails: { framing: "", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

async function insertIncomingHumanMessage(
  fromEngramId: number,
  content: string,
  createdAt: Date,
): Promise<number> {
  const [row] = await db
    .insert(engramMessagesTable)
    .values({
      fromEngramId,
      toEngramId: null,
      spaceId: null,
      channel: "human",
      author: "engram",
      priority: "social",
      status: "delivered",
      content,
      reason: null,
      seen: false,
      isDigest: false,
      digestedAt: null,
      deliveredAt: createdAt,
      createdAt,
    })
    .returning({ id: engramMessagesTable.id });
  return row.id;
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join("\n");
}

describe("createHumanDigest — real database concurrency", () => {
  it("creates one summary when two server passes race, then stays empty after commit", async () => {
    const engramId = await insertEngram();
    const sourceIds = await db
      .insert(engramMessagesTable)
      .values(
        [1, 2, 3].map((index) => ({
          fromEngramId: engramId,
          toEngramId: null,
          spaceId: null,
          channel: "human",
          author: "engram",
          priority: "social",
          status: "digest",
          content: `Held contact ${index}`,
          reason: null,
          seen: false,
          isDigest: false,
          digestedAt: null,
          deliveredAt: null,
          createdAt: new Date(`2026-09-13T12:0${index}:00.000Z`),
        })),
      )
      .returning({ id: engramMessagesTable.id });
    const ids = sourceIds.map(({ id }) => id);

    const [first, second] = await Promise.all([
      createHumanDigest(OWNER_ID, new Date("2026-09-13T12:10:00.000Z")),
      createHumanDigest(OWNER_ID, new Date("2026-09-13T12:11:00.000Z")),
    ]);

    const winners = [first, second].filter((summary) => summary !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toMatchObject({
      fromEngramId: engramId,
      isDigest: true,
      status: "digest",
    });

    const summaries = await db
      .select({ id: engramMessagesTable.id })
      .from(engramMessagesTable)
      .where(
        and(
          eq(engramMessagesTable.fromEngramId, engramId),
          eq(engramMessagesTable.isDigest, true),
        ),
      );
    expect(summaries).toHaveLength(1);

    const claimedSources = await db
      .select({
        id: engramMessagesTable.id,
        digestedAt: engramMessagesTable.digestedAt,
      })
      .from(engramMessagesTable)
      .where(
        and(
          eq(engramMessagesTable.fromEngramId, engramId),
          eq(engramMessagesTable.isDigest, false),
          isNotNull(engramMessagesTable.digestedAt),
        ),
      );
    expect(claimedSources.map(({ id }) => id).sort()).toEqual(ids.sort());
    expect(new Set(claimedSources.map(({ id }) => id)).size).toBe(ids.length);
    expect(claimedSources.every(({ digestedAt }) => digestedAt instanceof Date)).toBe(true);

    // A later server/ticker attempt sees the committed claims and cannot create
    // a second operator notification.
    await expect(
      createHumanDigest(OWNER_ID, new Date("2026-09-13T12:12:00.000Z")),
    ).resolves.toBeNull();
    await expect(
      db
        .select({ id: engramMessagesTable.id })
        .from(engramMessagesTable)
        .where(
          and(
            eq(engramMessagesTable.fromEngramId, engramId),
            eq(engramMessagesTable.isDigest, true),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("rolls back a partial digest when source claiming fails, then retries successfully", async () => {
    const engramId = await insertEngram();
    const sourceRows = await db
      .insert(engramMessagesTable)
      .values(
        [1, 2, 3].map((index) => ({
          fromEngramId: engramId,
          toEngramId: null,
          spaceId: null,
          channel: "human",
          author: "engram",
          priority: "social",
          status: "digest",
          content: `Held contact ${index}`,
          reason: null,
          seen: false,
          isDigest: false,
          digestedAt: null,
          deliveredAt: null,
          createdAt: new Date(`2026-09-13T12:0${index}:00.000Z`),
        })),
      )
      .returning({ id: engramMessagesTable.id });
    const sourceIds = sourceRows.map(({ id }) => id);
    const constraintName = "digest_source_claim_rollback_test_ck";

    await db.execute(
      sql.raw(
        `ALTER TABLE "engram_messages" DROP CONSTRAINT IF EXISTS "${constraintName}"`,
      ),
    );
    await db.execute(
      sql.raw(
        `ALTER TABLE "engram_messages" ADD CONSTRAINT "${constraintName}" CHECK ("is_digest" OR "digested_at" IS NULL)`,
      ),
    );

    try {
      let transactionFailure: unknown;
      try {
        await createHumanDigest(OWNER_ID, new Date("2026-09-13T12:10:00.000Z"));
      } catch (error) {
        transactionFailure = error;
      }
      expect(errorChainText(transactionFailure)).toContain(constraintName);

      const summariesAfterFailure = await db
        .select({ id: engramMessagesTable.id })
        .from(engramMessagesTable)
        .where(
          and(
            eq(engramMessagesTable.fromEngramId, engramId),
            eq(engramMessagesTable.isDigest, true),
          ),
        );
      expect(summariesAfterFailure).toHaveLength(0);

      const sourcesAfterFailure = await db
        .select({
          id: engramMessagesTable.id,
          status: engramMessagesTable.status,
          digestedAt: engramMessagesTable.digestedAt,
        })
        .from(engramMessagesTable)
        .where(
          and(
            eq(engramMessagesTable.fromEngramId, engramId),
            eq(engramMessagesTable.isDigest, false),
          ),
        );
      expect(sourcesAfterFailure.map(({ id }) => id).sort()).toEqual(sourceIds.sort());
      expect(sourcesAfterFailure.every(({ status }) => status === "digest")).toBe(true);
      expect(sourcesAfterFailure.every(({ digestedAt }) => digestedAt === null)).toBe(true);
    } finally {
      await db.execute(
        sql.raw(`ALTER TABLE "engram_messages" DROP CONSTRAINT "${constraintName}"`),
      );
    }

    const retriedSummary = await createHumanDigest(
      OWNER_ID,
      new Date("2026-09-13T12:12:00.000Z"),
    );
    expect(retriedSummary).toMatchObject({
      fromEngramId: engramId,
      isDigest: true,
      status: "digest",
    });
    expect(retriedSummary?.content).toContain("Held contact 1");
    expect(retriedSummary?.content).toContain("Held contact 2");
    expect(retriedSummary?.content).toContain("Held contact 3");

    const summariesAfterRetry = await db
      .select({ id: engramMessagesTable.id })
      .from(engramMessagesTable)
      .where(
        and(
          eq(engramMessagesTable.fromEngramId, engramId),
          eq(engramMessagesTable.isDigest, true),
        ),
      );
    expect(summariesAfterRetry).toHaveLength(1);

    const sourcesAfterRetry = await db
      .select({
        id: engramMessagesTable.id,
        digestedAt: engramMessagesTable.digestedAt,
      })
      .from(engramMessagesTable)
      .where(
        and(
          eq(engramMessagesTable.fromEngramId, engramId),
          eq(engramMessagesTable.isDigest, false),
        ),
      );
    expect(sourcesAfterRetry.map(({ id }) => id).sort()).toEqual(sourceIds.sort());
    expect(sourcesAfterRetry.every(({ digestedAt }) => digestedAt instanceof Date)).toBe(true);
  });
});

describe("operator reply acknowledgement — real database ownership", () => {
  it("preserves reply text and acknowledges only once for the owning user", async () => {
    const ownerEngramId = await insertEngram(OWNER_ID);
    const otherOwnerEngramId = await insertEngram(OTHER_OWNER_ID);
    const createdAt = new Date("2026-09-13T13:00:00.000Z");
    const ownerSourceId = await insertIncomingHumanMessage(
      ownerEngramId,
      "Can you check in when you have time?",
      createdAt,
    );
    const otherOwnerSourceId = await insertIncomingHumanMessage(
      otherOwnerEngramId,
      "Please keep this reply private.",
      createdAt,
    );
    const replyText = "I will check in after I finish this.";
    const ownerReply = await replyToMessage(OWNER_ID, ownerSourceId, replyText, createdAt);
    const otherOwnerReply = await replyToMessage(
      OTHER_OWNER_ID,
      otherOwnerSourceId,
      "I will keep this separate.",
      createdAt,
    );

    expect(ownerReply).not.toBeNull();
    expect(otherOwnerReply).not.toBeNull();
    if (!ownerReply || !otherOwnerReply) {
      throw new Error("Expected both owner-scoped operator replies to be inserted");
    }

    await expect(loadRecentOperatorReplyRows(OWNER_ID, ownerEngramId)).resolves.toEqual([
      {
        id: ownerReply.id,
        content: replyText,
        acknowledgedAt: null,
      },
    ]);
    await expect(
      loadRecentOperatorReplyRows(OWNER_ID, otherOwnerEngramId),
    ).resolves.toEqual([]);

    const acknowledgedAt = new Date("2026-09-13T13:05:00.000Z");
    await expect(
      markOperatorRepliesAcknowledged(OWNER_ID, ownerEngramId, [ownerReply.id], acknowledgedAt),
    ).resolves.toBe(1);
    await expect(
      markOperatorRepliesAcknowledged(OWNER_ID, ownerEngramId, [ownerReply.id], new Date()),
    ).resolves.toBe(0);
    await expect(
      markOperatorRepliesAcknowledged(OWNER_ID, otherOwnerEngramId, [otherOwnerReply.id], acknowledgedAt),
    ).resolves.toBe(0);

    const [storedOwnerReply] = await db
      .select({
        content: engramMessagesTable.content,
        acknowledgedAt: engramMessagesTable.acknowledgedAt,
      })
      .from(engramMessagesTable)
      .where(eq(engramMessagesTable.id, ownerReply.id));
    const [storedOtherOwnerReply] = await db
      .select({
        content: engramMessagesTable.content,
        acknowledgedAt: engramMessagesTable.acknowledgedAt,
      })
      .from(engramMessagesTable)
      .where(eq(engramMessagesTable.id, otherOwnerReply.id));

    expect(storedOwnerReply).toEqual({
      content: replyText,
      acknowledgedAt,
    });
    expect(storedOtherOwnerReply).toEqual({
      content: "I will keep this separate.",
      acknowledgedAt: null,
    });
  });
});
