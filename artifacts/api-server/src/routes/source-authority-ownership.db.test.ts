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
  engramWorldModelTable,
  engramsTable,
  ensureDatabaseReady,
  hubSpacesTable,
  messages,
  personalityTable,
} from "@workspace/db";
import {
  seedAll,
  seedEngrams,
  seedRebeccaAdaptiveProfile,
} from "@workspace/db/seed";
import {
  FULL_REZZ_BASE_TIMESTAMP_MS,
  FULL_REZZ_CONVERSATION_TITLE,
  FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "@workspace/db/seed/full-rezz-data";
import { and, eq } from "drizzle-orm";
import { ensureAccountBootstrap } from "../lib/account-bootstrap";
import { loadRecentWorldModel } from "../lib/world-model-store";
import {
  summarizeWorldModel,
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
} from "../lib/world-model";
import worldModelRouter from "./engram-world-model";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

function requestAs(ownerId: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-test-user-id", ownerId);
  return fetch(`${base}${path}`, { ...init, headers });
}

async function resetDatabase() {
  await db.delete(engramWorldModelTable);
  await db.delete(engramPresenceTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
  await db.delete(personalityTable);
  await db.delete(accountsTable);
}

async function seedAndBootstrap(ownerId: string) {
  await seedEngrams(db);
  await seedRebeccaAdaptiveProfile(db);
  await ensureAccountBootstrap(ownerId);
  const [rebecca] = await db
    .select()
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.ownerId, ownerId),
        eq(engramsTable.slug, "rebecca"),
      ),
    );
  if (!rebecca) throw new Error(`Rebecca was not bootstrapped for ${ownerId}`);
  return rebecca;
}

beforeAll(async () => {
  await ready;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.userId = req.header("x-test-user-id")!;
    next();
  });
  app.use(worldModelRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await ready;
  await resetDatabase();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
});

describe("Rebecca source authority with account ownership", () => {
  it("copies every canonical authority row into a fresh account prompt", async () => {
    const rebecca = await seedAndBootstrap("owner-a");
    const rows = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, rebecca.id));

    expect(rows.map((row) => row.source).sort()).toEqual(
      [...TRUSTED_REBECCA_ADAPTIVE_SOURCES].sort(),
    );

    const prompt = summarizeWorldModel(
      await loadRecentWorldModel(rebecca.id),
      { total: TRUSTED_REBECCA_ADAPTIVE_SOURCES.length },
    );
    expect(prompt).toContain("Rebecca source authority");
    expect(prompt).toContain(
      "Primary Edgerunners dialogue (highest character authority)",
    );
    expect(prompt).toContain(
      "Wuthering Waves crossover (alternate continuity)",
    );
  });

  it("does not reveal or mutate another account's world model by ID", async () => {
    const ownerARebecca = await seedAndBootstrap("owner-a");
    await ensureAccountBootstrap("owner-b");
    const [entry] = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, ownerARebecca.id));
    if (!entry) throw new Error("Owner A source row was not bootstrapped");

    expect(
      (
        await requestAs(
          "owner-b",
          `/engrams/${ownerARebecca.id}/world-model`,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await requestAs(
          "owner-b",
          `/engrams/${ownerARebecca.id}/world-model`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provenance: "remembered",
              content: "cross-account write",
              confidence: 1,
            }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await requestAs(
          "owner-b",
          `/engrams/${ownerARebecca.id}/world-model/${entry.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: "cross-account mutation" }),
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await requestAs(
          "owner-b",
          `/engrams/${ownerARebecca.id}/world-model/${entry.id}`,
          { method: "DELETE" },
        )
      ).status,
    ).toBe(404);

    const [unchanged] = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.id, entry.id));
    expect(unchanged).toMatchObject({
      content: entry.content,
      source: entry.source,
    });
    expect(
      (
        await requestAs(
          "owner-a",
          `/engrams/${ownerARebecca.id}/world-model`,
        )
      ).status,
    ).toBe(200);
  });

  it("keeps Full Rezz complete and system seeding safe after account bootstrap", async () => {
    await seedAll(db);
    await ensureAccountBootstrap("owner-a");

    const [accountArchive] = await db
      .select()
      .from(engramsTable)
      .where(
        and(
          eq(engramsTable.ownerId, "owner-a"),
          eq(engramsTable.slug, FULL_REZZ_SLUG),
        ),
      );
    expect(accountArchive).toMatchObject({
      isArchival: true,
      isChatActive: false,
    });

    const accountConversations = await db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.ownerId, "owner-a"),
          eq(conversations.engramId, accountArchive!.id),
        ),
      );
    expect(accountConversations).toHaveLength(1);
    expect(accountConversations[0]).toMatchObject({
      title: FULL_REZZ_CONVERSATION_TITLE,
      personaName: "Rebecca (Full Rezz)",
      mode: "companion",
    });

    const accountMessages = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, accountConversations[0]!.id))
      .orderBy(messages.createdAt, messages.id);
    expect(accountMessages).toHaveLength(fullRezzTranscript.length);
    for (let index = 0; index < fullRezzTranscript.length; index += 1) {
      expect(accountMessages[index]).toMatchObject({
        role: fullRezzTranscript[index]!.role,
        content: fullRezzTranscript[index]!.content,
        createdAt: new Date(FULL_REZZ_BASE_TIMESTAMP_MS + index * 1_000),
      });
    }

    await expect(seedAll(db)).resolves.toMatchObject({
      fullRezz: { engramInserted: false, messagesInserted: 0 },
    });
  });
});