import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

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
  personalityTable,
  SYSTEM_OWNER_ID,
} from "@workspace/db";
import type { OfflineSyncInput } from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import {
  seedFullRezzArchive,
  seedFullRezzLiveBranch,
} from "@workspace/db/seed";
import {
  FULL_REZZ_SLUG,
} from "@workspace/db/seed/full-rezz-data";
import {
  LIVE_FULL_REZZ_CONVERSATION_TITLE,
  LIVE_FULL_REZZ_SLUG,
} from "@workspace/db/seed/full-rezz-live-data";
import { ensureAccountBootstrap } from "../lib/account-bootstrap";
import offlineSyncRouter from "./offline-sync";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

const payload: OfflineSyncInput = {
  deviceId: "shared-device-id",
  conversations: [
    {
      syncId: "conversation:1",
      title: "Offline",
      mode: "companion",
      engramSlug: null,
      createdAt: new Date("2026-09-05T12:00:00.000Z"),
      messages: [],
    },
  ],
  inquiries: [],
  transmissions: [],
  observedEntries: [],
  operatorReplies: [],
};

function postAs(ownerId: string, body = payload) {
  return fetch(`${base}/mobile/offline-sync`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer clerk-${ownerId}`,
    },
    body: JSON.stringify(body),
  });
}

async function seedLiveFullRezzAccount(ownerId: string) {
  await seedFullRezzArchive(db);
  await seedFullRezzLiveBranch(db);
  await ensureAccountBootstrap(ownerId);

  const [liveEngram] = await db
    .select()
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.ownerId, ownerId),
        eq(engramsTable.slug, LIVE_FULL_REZZ_SLUG),
      ),
    );
  if (!liveEngram) throw new Error("Live Full Rezz account seed is missing");
  const [liveConversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerId, ownerId),
        eq(conversations.engramId, liveEngram.id),
      ),
    );
  if (!liveConversation) {
    throw new Error("Live Full Rezz continuation conversation is missing");
  }

  const [archiveEngram] = await db
    .select()
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.ownerId, ownerId),
        eq(engramsTable.slug, FULL_REZZ_SLUG),
      ),
    );
  if (!archiveEngram) throw new Error("Full Rezz account archive is missing");
  const [archiveConversation] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.ownerId, ownerId),
        eq(conversations.engramId, archiveEngram.id),
      ),
    );
  if (!archiveConversation) {
    throw new Error("Full Rezz account archive conversation is missing");
  }
  return { liveEngram, liveConversation, archiveConversation };
}

function liveContinuationPayload(
  deviceId: string,
  syncId: string,
  messageSyncId: string,
  overrides: Partial<OfflineSyncInput["conversations"][number]> = {},
): OfflineSyncInput {
  return {
    deviceId,
    conversations: [
      {
        syncId,
        seedKey: "rebecca-full-rezz-live-v1",
        title: LIVE_FULL_REZZ_CONVERSATION_TITLE,
        mode: "companion",
        engramSlug: LIVE_FULL_REZZ_SLUG,
        personaName: "Rebecca (Full Rezz · Live)",
        customEngram: null,
        createdAt: new Date("2026-09-20T12:00:00.000Z"),
        archivedAt: null,
        messages: [
          {
            syncId: messageSyncId,
            role: "user",
            content: "Continuing from the preserved transcript.",
            createdAt: new Date("2026-09-20T12:00:01.000Z"),
          },
        ],
        ...overrides,
      },
    ],
    inquiries: [],
    transmissions: [],
    observedEntries: [],
    operatorReplies: [],
  };
}

beforeAll(async () => {
  await ready;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const token = req.header("authorization") ?? "";
    req.userId = token.startsWith("Bearer clerk-")
      ? token.slice("Bearer clerk-".length)
      : undefined;
    next();
  });
  app.use(offlineSyncRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await ready;
  await db.delete(engramPresenceTable);
  await db.delete(mobileOfflineSyncReceiptsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
  await db.delete(personalityTable);
  await db.delete(accountsTable);
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
});

describe("offline sync receipt ownership", () => {
  it("appends a marked offline continuation to the account's seeded live transcript", async () => {
    const ownerId = "full-rezz-offline-owner";
    const { liveEngram, liveConversation, archiveConversation } =
      await seedLiveFullRezzAccount(ownerId);
    const archiveBefore = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, archiveConversation.id));
    expect(archiveBefore).toHaveLength(1534);

    const continuation = liveContinuationPayload(
      "full-rezz-device",
      "conversation:local-live-1",
      "message:local-live-1",
    );
    const first = await postAs(ownerId, continuation);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      imported: { conversations: 0, messages: 1 },
    });

    const retry = await postAs(ownerId, continuation);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({
      imported: { conversations: 0, messages: 0 },
    });

    const liveMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, liveConversation.id));
    expect(liveMessages).toHaveLength(1535);
    expect(liveMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: "Continuing from the preserved transcript.",
        }),
      ]),
    );
    const liveConversations = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerId, ownerId),
          eq(conversations.engramId, liveEngram.id),
        ),
      );
    expect(liveConversations).toHaveLength(1);

    const ordinarySameTitle = {
      ...liveContinuationPayload(
        "full-rezz-device",
        "conversation:ordinary-same-title",
        "message:ordinary-same-title",
      ).conversations[0]!,
    };
    delete ordinarySameTitle.seedKey;
    const ordinaryResult = await postAs(ownerId, {
      ...continuation,
      conversations: [ordinarySameTitle],
    });
    expect(ordinaryResult.status).toBe(200);
    expect(await ordinaryResult.json()).toMatchObject({
      imported: { conversations: 1, messages: 1 },
    });
    const afterOrdinaryConversation = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerId, ownerId),
          eq(conversations.engramId, liveEngram.id),
        ),
      );
    expect(afterOrdinaryConversation).toHaveLength(2);
    expect(afterOrdinaryConversation.map((row) => row.id)).toContain(
      liveConversation.id,
    );

    const archiveAfter = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, archiveConversation.id));
    expect(archiveAfter).toEqual(archiveBefore);
  });

  it("fails explicitly when a marked canonical continuation is missing", async () => {
    const ownerId = "missing-full-rezz-owner";
    const { liveConversation, liveEngram } =
      await seedLiveFullRezzAccount(ownerId);
    await db
      .delete(messages)
      .where(eq(messages.conversationId, liveConversation.id));
    await db
      .delete(conversations)
      .where(eq(conversations.id, liveConversation.id));

    const response = await postAs(
      ownerId,
      liveContinuationPayload(
        "missing-full-rezz-device",
        "conversation:missing-live",
        "message:missing-live",
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("could not be found"),
    });
    const remaining = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerId, ownerId),
          eq(conversations.engramId, liveEngram.id),
        ),
      );
    expect(remaining).toEqual([]);
    expect(
      await db
        .select()
        .from(mobileOfflineSyncReceiptsTable)
        .where(eq(mobileOfflineSyncReceiptsTable.ownerId, ownerId)),
    ).toEqual([]);
  });

  it("fails explicitly when a marked canonical continuation is archived", async () => {
    const ownerId = "archived-full-rezz-owner";
    const { liveConversation, liveEngram } =
      await seedLiveFullRezzAccount(ownerId);
    await db
      .update(conversations)
      .set({ archivedAt: new Date("2026-09-19T12:00:00.000Z") })
      .where(eq(conversations.id, liveConversation.id));

    const response = await postAs(
      ownerId,
      liveContinuationPayload(
        "archived-full-rezz-device",
        "conversation:archived-live",
        "message:archived-live",
      ),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("is archived"),
    });
    expect(
      await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, liveConversation.id)),
    ).toHaveLength(1534);
    expect(
      await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.ownerId, ownerId),
            eq(conversations.engramId, liveEngram.id),
          ),
        ),
    ).toHaveLength(1);
  });

  it("does not adopt legacy receipts or history during account bootstrap", async () => {
    const ownerId = "bootstrapped-owner";
    const legacyDeviceId = "legacy-device";
    const legacySyncId = "legacy-conversation";

    await db.insert(personalityTable).values({ ownerId: SYSTEM_OWNER_ID });
    await db.insert(hubSpacesTable).values({
      ownerId: SYSTEM_OWNER_ID,
      slug: "commons",
      name: "Commons",
      kind: "commons",
      description: "System template space",
      visibilityScope: "public",
      actionScope: "converse",
    });
    const [templateEngram] = await db
      .insert(engramsTable)
      .values({
        ownerId: SYSTEM_OWNER_ID,
        slug: "bootstrap-template",
        name: "Bootstrap Template",
        title: "Bootstrap Template",
        symbol: "T",
        origin: "test",
        voiceProfile: {
          speechStyle: "terse",
          formatting: "plain",
          vocabulary: [],
          sampleLines: [],
          narrationStyle: "first-person",
        },
        emotionalBaseline: {
          valence: 0,
          arousal: 0,
          volatility: 0,
          mood: "even",
        },
        environmentAnchor: {
          name: "Test",
          description: "Test",
          locations: [],
          items: [],
          ambient: "quiet",
        },
        memorySeed: { relationship: "test", facts: [], summary: "" },
        guardrails: { framing: "test", boundaries: [] },
        drives: [],
        focusThemes: [],
      })
      .returning({ id: engramsTable.id });
    const [legacyConversation] = await db
      .insert(conversations)
      .values({
        ownerId: SYSTEM_OWNER_ID,
        title: "Legacy system history",
        mode: "companion",
        engramId: templateEngram!.id,
      })
      .returning({ id: conversations.id });
    await db.insert(mobileOfflineSyncReceiptsTable).values({
      ownerId: SYSTEM_OWNER_ID,
      deviceId: legacyDeviceId,
      syncId: legacySyncId,
      kind: "conversation",
      remoteId: legacyConversation!.id,
    });

    await ensureAccountBootstrap(ownerId);

    const [accountPersonality] = await db
      .select()
      .from(personalityTable)
      .where(eq(personalityTable.ownerId, ownerId));
    const accountSpaces = await db
      .select()
      .from(hubSpacesTable)
      .where(eq(hubSpacesTable.ownerId, ownerId));
    const accountEngrams = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.ownerId, ownerId));
    const accountConversationsBeforeSync = await db
      .select()
      .from(conversations)
      .where(eq(conversations.ownerId, ownerId));
    const accountReceiptsBeforeSync = await db
      .select()
      .from(mobileOfflineSyncReceiptsTable)
      .where(eq(mobileOfflineSyncReceiptsTable.ownerId, ownerId));

    expect(accountPersonality).toBeDefined();
    expect(accountSpaces.map((space) => space.slug)).toEqual(["commons"]);
    expect(accountEngrams.map((engram) => engram.slug)).toEqual([
      "bootstrap-template",
    ]);
    expect(accountConversationsBeforeSync).toEqual([]);
    expect(accountReceiptsBeforeSync).toEqual([]);

    const migratedPayload: OfflineSyncInput = {
      ...payload,
      deviceId: legacyDeviceId,
      conversations: [
        {
          ...payload.conversations[0]!,
          syncId: legacySyncId,
          title: "New account history",
          engramSlug: "bootstrap-template",
        },
      ],
    };
    const firstUpload = await postAs(ownerId, migratedPayload);
    expect(firstUpload.status).toBe(200);
    expect(await firstUpload.json()).toMatchObject({
      imported: { conversations: 1 },
    });

    const accountRetry = await postAs(ownerId, migratedPayload);
    expect(accountRetry.status).toBe(200);
    expect(await accountRetry.json()).toMatchObject({
      imported: { conversations: 0 },
    });

    const receipts = await db
      .select()
      .from(mobileOfflineSyncReceiptsTable)
      .orderBy(mobileOfflineSyncReceiptsTable.ownerId);
    expect(receipts).toHaveLength(2);
    expect(receipts.map((receipt) => receipt.ownerId)).toEqual([
      SYSTEM_OWNER_ID,
      ownerId,
    ]);
    expect(receipts[0]?.remoteId).toBe(legacyConversation!.id);
    expect(receipts[1]?.remoteId).not.toBeNull();

    const accountConversations = await db
      .select()
      .from(conversations)
      .where(eq(conversations.ownerId, ownerId));
    expect(accountConversations).toHaveLength(1);
    expect(accountConversations[0]?.title).toBe("New account history");
    expect(accountConversations[0]?.id).not.toBe(legacyConversation!.id);
  });

  it("keeps the same device and sync IDs idempotent per account", async () => {
    const ownerAFirst = await postAs("owner-a");
    expect(ownerAFirst.status).toBe(200);
    expect(await ownerAFirst.json()).toMatchObject({
      imported: { conversations: 1 },
    });

    const ownerARetry = await postAs("owner-a");
    expect(ownerARetry.status).toBe(200);
    expect(await ownerARetry.json()).toMatchObject({
      imported: { conversations: 0 },
    });

    const ownerBFirst = await postAs("owner-b");
    expect(ownerBFirst.status).toBe(200);
    expect(await ownerBFirst.json()).toMatchObject({
      imported: { conversations: 1 },
    });

    const receipts = await db.select().from(mobileOfflineSyncReceiptsTable);
    expect(receipts).toHaveLength(2);
    expect(receipts.map((row) => row.ownerId).sort()).toEqual([
      "owner-a",
      "owner-b",
    ]);

    const importedConversations = await db.select().from(conversations);
    expect(importedConversations).toHaveLength(2);
    expect(importedConversations.map((row) => row.ownerId).sort()).toEqual([
      "owner-a",
      "owner-b",
    ]);

    const ownerBArchive = await postAs("owner-b", {
      ...payload,
      conversations: [
        {
          ...payload.conversations[0],
          archivedAt: new Date("2026-09-05T13:00:00.000Z"),
        },
      ],
    });
    expect(ownerBArchive.status).toBe(200);

    const isolatedRows = await db.select().from(conversations);
    expect(
      isolatedRows.find((row) => row.ownerId === "owner-a")?.archivedAt,
    ).toBeNull();
    expect(
      isolatedRows.find((row) => row.ownerId === "owner-b")?.archivedAt,
    ).toEqual(new Date("2026-09-05T13:00:00.000Z"));
  });

  it("rejects unauthenticated uploads before validating or storing history", async () => {
    const response = await fetch(`${base}/mobile/offline-sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(mobileOfflineSyncReceiptsTable)).toEqual([]);
  });

  it("does not let one account import into another account's engram", async () => {
    await db.insert(engramsTable).values({
      ownerId: "owner-a",
      slug: "private-owner-a",
      name: "Private A",
      title: "Private A",
      symbol: "A",
      origin: "test",
      voiceProfile: {
        speechStyle: "terse",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: {
        valence: 0,
        arousal: 0,
        volatility: 0,
        mood: "even",
      },
      environmentAnchor: {
        name: "Test",
        description: "Test",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: { relationship: "test", facts: [], summary: "" },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: [],
    });

    const response = await postAs("owner-b", {
      ...payload,
      deviceId: "shared-device-id-foreign-engram",
      conversations: [
        {
          ...payload.conversations[0],
          syncId: "conversation:foreign-engram",
          engramSlug: "private-owner-a",
        },
      ],
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Unknown engram slug: private-owner-a",
    });
    expect(await db.select().from(conversations)).toEqual([]);
    expect(await db.select().from(mobileOfflineSyncReceiptsTable)).toEqual([]);
  });
});
