import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  accountsTable,
  closeDb,
  conversations,
  db,
  engramPresenceTable,
  engramsTable,
  ensureDatabaseReady,
  hubSpacesTable,
  messages,
  mobileOfflineSyncReceiptsTable,
  mobilePushTokensTable,
  personalityTable,
  SYSTEM_OWNER_ID,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  cleanupDisposableAccount,
  ensureAccountBootstrap,
} from "./account-bootstrap";

const ready = ensureDatabaseReady({ seed: false });
const ownerId = "disposable-browser-check-owner";

async function resetDatabase() {
  await db.delete(mobilePushTokensTable);
  await db.delete(mobileOfflineSyncReceiptsTable);
  await db.delete(engramPresenceTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
  await db.delete(personalityTable);
  await db.delete(accountsTable);
}

beforeAll(async () => {
  await ready;
});

beforeEach(async () => {
  await ready;
  await resetDatabase();
});

afterAll(async () => {
  await resetDatabase();
  await closeDb();
});

describe("disposable account cleanup", () => {
  it("removes bootstrap rows and preserves the system template owner", async () => {
    await db.insert(accountsTable).values({ id: SYSTEM_OWNER_ID });
    await db.insert(personalityTable).values({ ownerId: SYSTEM_OWNER_ID });
    const [systemSpace] = await db
      .insert(hubSpacesTable)
      .values({
        ownerId: SYSTEM_OWNER_ID,
        slug: "commons",
        name: "Commons",
        kind: "commons",
        description: "System template space",
        visibilityScope: "public",
        actionScope: "converse",
      })
      .returning({ id: hubSpacesTable.id });
    await db.insert(engramsTable).values({
      ownerId: SYSTEM_OWNER_ID,
      slug: "template",
      name: "Template",
      title: "Template",
      symbol: "T",
      origin: "test",
      voiceProfile: {
        speechStyle: "plain",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: {
        valence: 0,
        arousal: 0,
        volatility: 0,
        mood: "steady",
      },
      environmentAnchor: {
        name: "Test",
        description: "Test",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: {
        relationship: "test",
        facts: [],
        summary: "test",
      },
      guardrails: {
        framing: "test",
        boundaries: [],
      },
      drives: [],
      focusThemes: [],
    });

    await ensureAccountBootstrap(ownerId);
    const [ownerEngram] = await db
      .select({ id: engramsTable.id })
      .from(engramsTable)
      .where(and(eq(engramsTable.ownerId, ownerId), eq(engramsTable.slug, "template")));
    const [ownerSpace] = await db
      .select({ id: hubSpacesTable.id })
      .from(hubSpacesTable)
      .where(and(eq(hubSpacesTable.ownerId, ownerId), eq(hubSpacesTable.slug, "commons")));
    expect(ownerEngram).toBeDefined();
    expect(ownerSpace).toBeDefined();

    const [conversation] = await db
      .insert(conversations)
      .values({
        ownerId,
        title: "Disposable browser check",
        engramId: ownerEngram!.id,
      })
      .returning({ id: conversations.id });
    await db.insert(messages).values({
      conversationId: conversation!.id,
      role: "user",
      content: "temporary transcript",
    });
    await db.insert(mobileOfflineSyncReceiptsTable).values({
      ownerId,
      deviceId: "browser-check",
      syncId: "temporary",
      kind: "conversation",
    });
    await db.insert(mobilePushTokensTable).values({
      ownerId,
      token: "temporary-browser-token",
      platform: "web",
    });

    await cleanupDisposableAccount(ownerId);
    await expect(cleanupDisposableAccount(ownerId)).resolves.toBeUndefined();

    expect(await db.select().from(accountsTable).where(eq(accountsTable.id, ownerId))).toEqual([]);
    expect(await db.select().from(personalityTable).where(eq(personalityTable.ownerId, ownerId))).toEqual([]);
    expect(await db.select().from(hubSpacesTable).where(eq(hubSpacesTable.ownerId, ownerId))).toEqual([]);
    expect(await db.select().from(engramsTable).where(eq(engramsTable.ownerId, ownerId))).toEqual([]);
    expect(await db.select().from(conversations).where(eq(conversations.ownerId, ownerId))).toEqual([]);
    expect(await db.select().from(messages)).toEqual([]);
    expect(await db.select().from(engramPresenceTable)).toEqual([]);
    expect(await db.select().from(mobileOfflineSyncReceiptsTable).where(eq(mobileOfflineSyncReceiptsTable.ownerId, ownerId))).toEqual([]);
    expect(await db.select().from(mobilePushTokensTable).where(eq(mobilePushTokensTable.ownerId, ownerId))).toEqual([]);

    expect(await db.select().from(accountsTable).where(eq(accountsTable.id, SYSTEM_OWNER_ID))).toHaveLength(1);
    expect(await db.select().from(personalityTable).where(eq(personalityTable.ownerId, SYSTEM_OWNER_ID))).toHaveLength(1);
    expect(await db.select().from(hubSpacesTable).where(eq(hubSpacesTable.id, systemSpace!.id))).toHaveLength(1);
    expect(await db.select().from(engramsTable).where(eq(engramsTable.ownerId, SYSTEM_OWNER_ID))).toHaveLength(1);
  });

  it("refuses to clean the reserved system owner", async () => {
    await expect(cleanupDisposableAccount(SYSTEM_OWNER_ID)).rejects.toThrow(
      "system template account",
    );
  });
});