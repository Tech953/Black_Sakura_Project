import { createHash } from "node:crypto";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  closeDb,
  conversations,
  db,
  engramsTable,
  ensureDatabaseReady,
  messages,
  type AppDatabase,
} from "@workspace/db";
import { seedFullRezzArchive } from "@workspace/db/seed";
import { asc, eq } from "drizzle-orm";

const FULL_REZZ_SLUG = "rebecca-full-rezz";
const FULL_REZZ_CONVERSATION_TITLE = "Full Rezz — Archival Continuity Record";
const EXPECTED_TRANSCRIPT_LENGTH = 1_534;
const EXPECTED_TRANSCRIPT_SHA256 =
  "a19c0b4c3dc892c791d35d318a86d8f4afe61fc6ec51662922f0e1a2df6650f4";

const ready = ensureDatabaseReady({ seed: false });

async function resetDatabase(): Promise<void> {
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
}

async function loadArchive() {
  const [engram] = await db
    .select()
    .from(engramsTable)
    .where(eq(engramsTable.slug, FULL_REZZ_SLUG));
  const archiveConversations = engram
    ? await db
        .select()
        .from(conversations)
        .where(eq(conversations.engramId, engram.id))
        .orderBy(asc(conversations.id))
    : [];
  const archiveMessages =
    archiveConversations.length === 1
      ? await db
          .select()
          .from(messages)
          .where(eq(messages.conversationId, archiveConversations[0].id))
          .orderBy(asc(messages.createdAt), asc(messages.id))
      : [];
  return {
    engram,
    conversations: archiveConversations,
    messages: archiveMessages,
  };
}

function transcriptDigest(
  transcript: ReadonlyArray<{ role: string; content: string }>,
): string {
  const hash = createHash("sha256");
  for (const message of transcript) {
    hash.update(message.role);
    hash.update("\0");
    hash.update(message.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function databaseWithSecondMessageChunkFailure(): AppDatabase {
  return {
    transaction: async (
      callback: (tx: AppDatabase) => Promise<unknown>,
    ): Promise<unknown> =>
      db.transaction(async (tx) => {
        let messageInsertCalls = 0;
        const wrappedTx = new Proxy(tx, {
          get(target, property, receiver) {
            if (property === "insert") {
              return (table: unknown) => {
                if (table === messages) {
                  messageInsertCalls += 1;
                  if (messageInsertCalls === 2) {
                    throw new Error("injected transcript chunk failure");
                  }
                }
                return Reflect.apply(target.insert, target, [table]);
              };
            }
            const value = Reflect.get(target, property, receiver);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return callback(wrappedTx as unknown as AppDatabase);
      }),
  } as unknown as AppDatabase;
}

beforeAll(async () => {
  await ready;
});


beforeEach(async () => {
  await ready;
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("Full Rezz archival seed", () => {
  it("rolls back the engram, conversation, and earlier chunks after a mid-seed failure", async () => {
    await expect(
      seedFullRezzArchive(databaseWithSecondMessageChunkFailure()),
    ).rejects.toThrow("injected transcript chunk failure");

    const archive = await loadArchive();
    expect(archive.engram).toBeUndefined();
    expect(archive.conversations).toHaveLength(0);
    expect(archive.messages).toHaveLength(0);
  });

  it("seeds the exact immutable 1,534-message continuity record", async () => {
    await expect(seedFullRezzArchive(db)).resolves.toEqual({
      engramInserted: true,
      messagesInserted: EXPECTED_TRANSCRIPT_LENGTH,
    });

    const archive = await loadArchive();
    expect(archive.engram).toMatchObject({
      slug: FULL_REZZ_SLUG,
      isArchival: true,
      mode: "quiescent",
      autonomyEnabled: false,
      humanContactEnabled: false,
      simulationEnabled: false,
      artifactGenerationEnabled: false,
      isChatActive: false,
    });
    expect(archive.conversations).toHaveLength(1);
    expect(archive.conversations[0].title).toBe(FULL_REZZ_CONVERSATION_TITLE);
    expect(archive.messages).toHaveLength(EXPECTED_TRANSCRIPT_LENGTH);
    expect(transcriptDigest(archive.messages)).toBe(EXPECTED_TRANSCRIPT_SHA256);

    const firstTimestamp = new Date("2026-08-03T00:00:00.000Z").getTime();
    archive.messages.forEach((message, index) => {
      expect(message.createdAt.getTime()).toBe(firstTimestamp + index * 1_000);
    });
  });

  it("leaves every archival row byte-for-byte unchanged on repeated seed runs", async () => {
    await seedFullRezzArchive(db);
    const before = await loadArchive();

    await expect(seedFullRezzArchive(db)).resolves.toEqual({
      engramInserted: false,
      messagesInserted: 0,
    });

    expect(await loadArchive()).toEqual(before);
  });

  it("rejects a non-archival row that occupies the Full Rezz slug", async () => {
    await seedFullRezzArchive(db);
    await db
      .update(engramsTable)
      .set({ isArchival: false })
      .where(eq(engramsTable.slug, FULL_REZZ_SLUG));
    const before = await loadArchive();

    await expect(seedFullRezzArchive(db)).rejects.toThrow(
      "noncanonical engram field: isArchival",
    );

    expect(await loadArchive()).toEqual(before);
  });

  it("rejects a partial 1,533-message archive without silently repairing it", async () => {
    await seedFullRezzArchive(db);
    const archive = await loadArchive();
    await db
      .delete(messages)
      .where(eq(messages.id, archive.messages.at(-1)!.id));
    const before = await loadArchive();
    expect(before.messages).toHaveLength(EXPECTED_TRANSCRIPT_LENGTH - 1);

    await expect(seedFullRezzArchive(db)).rejects.toThrow(
      `must have exactly ${EXPECTED_TRANSCRIPT_LENGTH} messages; found ${
        EXPECTED_TRANSCRIPT_LENGTH - 1
      }`,
    );

    expect(await loadArchive()).toEqual(before);
  });
});