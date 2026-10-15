import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const { hasPg, testSchema } = vi.hoisted(() => {
  const testDatabaseUrl = process.env.ENGRAM_TEST_DATABASE_URL;
  if (!testDatabaseUrl) {
    if (process.env.ENGRAM_REQUIRE_MESSAGES_PAGINATION_PG === "1") {
      throw new Error(
        "Message pagination integration checks require ENGRAM_TEST_DATABASE_URL.",
      );
    }
    process.env.ENGRAM_DB_DRIVER = "pglite";
    delete process.env.PGLITE_DATA_DIR;
    return { hasPg: false, testSchema: "" };
  }

  const url = new URL(testDatabaseUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    !databaseName.toLowerCase().includes("test")
  ) {
    throw new Error(
      "Message pagination checks only accept a loopback PostgreSQL test database.",
    );
  }

  process.env.ENGRAM_DB_DRIVER = "node-postgres";
  const schema = `messages_cursor_test_${process.pid}_${Date.now()}`;
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  return { hasPg: true, testSchema: schema };
});

import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { closeDb, db, engramMessagesTable, engramsTable } from "@workspace/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import messagesRouter from "./messages";

const suite = describe.skipIf(!hasPg);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/drizzle",
);

const OWNER_A = "messages-pagination-owner-a";
const OWNER_B = "messages-pagination-owner-b";
const TIE_TIMESTAMP = new Date("2026-09-13T12:00:00.000Z");
const NEWER_TIMESTAMP = new Date("2026-09-13T12:01:00.000Z");
const OLDER_TIMESTAMP = new Date("2026-09-13T11:59:00.000Z");

type RouteMessage = {
  id: number;
  fromEngramId: number;
  channel: string;
  content: string;
  createdAt: string;
};

let server: Server | undefined;
let base = "";
let temporaryMigrationsRoot: string | undefined;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { userId: string }).userId =
      req.header("x-test-owner") ?? OWNER_A;
    next();
  });
  app.use("/api", messagesRouter);
  return app;
}

beforeAll(async () => {
  if (!hasPg) return;

  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`));
  temporaryMigrationsRoot = await mkdtemp(
    path.join(os.tmpdir(), "messages-pagination-migrations-"),
  );
  const isolatedMigrationsFolder = path.join(temporaryMigrationsRoot, "drizzle");
  await cp(migrationsFolder, isolatedMigrationsFolder, { recursive: true });
  for (const entry of await readdir(isolatedMigrationsFolder)) {
    if (!entry.endsWith(".sql")) continue;
    const migrationPath = path.join(isolatedMigrationsFolder, entry);
    const migration = await readFile(migrationPath, "utf8");
    await writeFile(
      migrationPath,
      migration.replaceAll('"public".', `"${testSchema}".`),
    );
  }
  await migrate(db, {
    migrationsFolder: isolatedMigrationsFolder,
    migrationsSchema: testSchema,
    migrationsTable: "__drizzle_migrations",
  });

  server = await new Promise<Server>((resolve) => {
    const listener = buildApp().listen(0, () => resolve(listener));
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

beforeEach(async () => {
  if (!hasPg) return;
  await db.delete(engramMessagesTable);
  await db.delete(engramsTable);
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
  }

  try {
    if (hasPg) {
      await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`));
    }
  } finally {
    await closeDb();
    if (temporaryMigrationsRoot) {
      await rm(temporaryMigrationsRoot, { recursive: true, force: true });
    }
  }
});

async function insertEngram(ownerId: string, slug: string): Promise<number> {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId,
      slug,
      name: "Pagination Test",
      title: "Pagination integration test",
      symbol: "P",
      origin: "Message pagination integration test",
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
        mood: "even",
      },
      environmentAnchor: {
        name: "Pagination test",
        description: "Disposable database fixture",
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
  return row.id;
}

function messageValue(
  fromEngramId: number,
  channel: "human" | "engram",
  content: string,
  createdAt: Date,
) {
  return {
    fromEngramId,
    toEngramId: null,
    spaceId: null,
    channel,
    author: "engram" as const,
    priority: channel === "human" ? ("social" as const) : ("meaningful" as const),
    status: "delivered" as const,
    content,
    reason: null,
    seen: false,
    isDigest: false,
    digestedAt: null,
    deliveredAt: createdAt,
    createdAt,
  };
}

async function fetchMessages(
  ownerId: string,
  query: Record<string, string>,
): Promise<{ status: number; messages: RouteMessage[] }> {
  const url = new URL("/api/messages", base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  const response = await fetch(url, {
    headers: { "x-test-owner": ownerId },
  });
  return {
    status: response.status,
    messages: (await response.json()) as RouteMessage[],
  };
}

suite("GET /api/messages — real PostgreSQL cursor pagination", () => {
  it("continues equal timestamps and enforces the limit, owner, and channel filters", async () => {
    const ownerAHumanEngramId = await insertEngram(OWNER_A, "cursor-human-a");
    const ownerAEngramChannelId = await insertEngram(OWNER_A, "cursor-engram-a");
    const ownerBHumanEngramId = await insertEngram(OWNER_B, "cursor-human-b");

    const tieContents = Array.from(
      { length: 502 },
      (_, index) => `owner-a-human-tie-${index}`,
    );
    const values = [
      messageValue(
        ownerAHumanEngramId,
        "human",
        "owner-a-human-newer",
        NEWER_TIMESTAMP,
      ),
      messageValue(
        ownerBHumanEngramId,
        "human",
        "owner-b-human-newer",
        new Date("2026-09-13T12:03:00.000Z"),
      ),
      messageValue(
        ownerAEngramChannelId,
        "engram",
        "owner-a-engram-newer",
        new Date("2026-09-13T12:02:00.000Z"),
      ),
    ];
    for (const [index, content] of tieContents.entries()) {
      values.push(messageValue(ownerAHumanEngramId, "human", content, TIE_TIMESTAMP));
      if (index === 10) {
        values.push(
          messageValue(
            ownerBHumanEngramId,
            "human",
            "owner-b-human-tie",
            TIE_TIMESTAMP,
          ),
          messageValue(
            ownerAEngramChannelId,
            "engram",
            "owner-a-engram-tie",
            TIE_TIMESTAMP,
          ),
        );
      }
    }
    values.push(
      messageValue(
        ownerAHumanEngramId,
        "human",
        "owner-a-human-older",
        OLDER_TIMESTAMP,
      ),
    );

    const inserted = await db
      .insert(engramMessagesTable)
      .values(values)
      .returning({
        id: engramMessagesTable.id,
        content: engramMessagesTable.content,
      });
    const idByContent = new Map(inserted.map((row) => [row.content, row.id]));
    const idFor = (content: string) => {
      const id = idByContent.get(content);
      if (id === undefined) throw new Error(`Missing message fixture ${content}`);
      return id;
    };
    const tiedIdsNewestFirst = tieContents
      .map(idFor)
      .sort((left, right) => right - left);

    const first = await fetchMessages(OWNER_A, {
      channel: "human",
      limit: "3",
    });
    expect(first.status).toBe(200);
    expect(first.messages.map(({ id }) => id)).toEqual([
      idFor("owner-a-human-newer"),
      ...tiedIdsNewestFirst.slice(0, 2),
    ]);

    const second = await fetchMessages(OWNER_A, {
      channel: "human",
      limit: "3",
      before: first.messages[2]!.createdAt,
      beforeId: String(first.messages[2]!.id),
    });
    expect(second.status).toBe(200);
    expect(second.messages.map(({ id }) => id)).toEqual(
      tiedIdsNewestFirst.slice(2, 5),
    );
    expect(second.messages.every(({ createdAt }) => createdAt === TIE_TIMESTAMP.toISOString())).toBe(true);

    const third = await fetchMessages(OWNER_A, {
      channel: "human",
      limit: "3",
      before: second.messages[2]!.createdAt,
      beforeId: String(second.messages[2]!.id),
    });
    expect(third.status).toBe(200);
    expect(third.messages.map(({ id }) => id)).toEqual(
      tiedIdsNewestFirst.slice(5, 8),
    );
    const pagedIds = [
      ...first.messages,
      ...second.messages,
      ...third.messages,
    ].map(({ id }) => id);
    expect(new Set(pagedIds).size).toBe(pagedIds.length);

    const clamped = await fetchMessages(OWNER_A, {
      channel: "human",
      limit: "9999",
    });
    expect(clamped.status).toBe(200);
    expect(clamped.messages).toHaveLength(500);
    expect(clamped.messages[0]?.id).toBe(idFor("owner-a-human-newer"));
    expect(clamped.messages.at(-1)?.id).toBe(tiedIdsNewestFirst[498]);
    expect(
      clamped.messages.every(
        ({ channel, fromEngramId }) =>
          channel === "human" && fromEngramId === ownerAHumanEngramId,
      ),
    ).toBe(true);

    const ownerAEngramMessages = await fetchMessages(OWNER_A, {
      channel: "engram",
      limit: "50",
    });
    expect(ownerAEngramMessages.status).toBe(200);
    expect(ownerAEngramMessages.messages.map(({ content }) => content)).toEqual([
      "owner-a-engram-newer",
      "owner-a-engram-tie",
    ]);

    const ownerBMessages = await fetchMessages(OWNER_B, {
      channel: "human",
      limit: "50",
    });
    expect(ownerBMessages.status).toBe(200);
    expect(ownerBMessages.messages.map(({ content }) => content)).toEqual([
      "owner-b-human-newer",
      "owner-b-human-tie",
    ]);
  });
});
