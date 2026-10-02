import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

/**
 * PGlite serializes transactions on one connection, so it cannot prove that
 * two independent operators contend on the same row. When a real Postgres
 * connection is available, this suite uses a throwaway schema and separate
 * pooled connections to verify the per-engram lock.
 */
const { hasPg, testSchema } = vi.hoisted(() => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    if (process.env.ENGRAM_REQUIRE_HUB_CONCURRENCY_PG === "1") {
      throw new Error(
        "Hub concurrency checks require DATABASE_URL; PostgreSQL was explicitly required for this run.",
      );
    }
    process.stderr.write(
      "[Hub concurrency] PostgreSQL checks skipped: DATABASE_URL is not set (2 tests will be reported as skipped).\n",
    );
    process.env.ENGRAM_DB_DRIVER = "pglite";
    delete process.env.PGLITE_DATA_DIR;
    return { hasPg: false, testSchema: "" };
  }

  process.env.ENGRAM_DB_DRIVER = "node-postgres";
  delete process.env.PGLITE_DATA_DIR;
  const schema = `hub_conc_test_${process.pid}_${Date.now()}`;
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  return { hasPg: true, testSchema: schema };
});

import {
  closeDb,
  db,
  engramPresenceTable,
  engramsTable,
  ensureDatabaseReady,
  hubActivityLogTable,
  hubSpacesTable,
} from "@workspace/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq, sql } from "drizzle-orm";
import { movePresence } from "./hub-store";

const suite = describe.skipIf(!hasPg);
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/drizzle",
);
const OWNER_ID = "hub-concurrency-test-owner";
let temporaryMigrationsRoot: string | undefined;

beforeAll(async () => {
  if (!hasPg) return;
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`));

  // Generated migrations qualify foreign-key targets with public.*. Rewrite a
  // temporary copy so every table and reference stays inside this disposable
  // schema, including when the PostgreSQL target starts empty in CI.
  temporaryMigrationsRoot = await mkdtemp(
    path.join(os.tmpdir(), "hub-concurrency-migrations-"),
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
});

beforeEach(async () => {
  if (!hasPg) return;
  await db.delete(hubActivityLogTable);
  await db.delete(engramPresenceTable);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
});

afterAll(async () => {
  if (hasPg) {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`));
  }
  if (temporaryMigrationsRoot) {
    await rm(temporaryMigrationsRoot, { recursive: true, force: true });
  }
  await closeDb();
});

async function insertFixture() {
  const [engram] = await db
    .insert(engramsTable)
    .values({
      ownerId: OWNER_ID,
      slug: `concurrency-${Date.now()}`,
      name: "Concurrent Engram",
      title: "Concurrency test",
      symbol: "C",
      origin: "Hub concurrency test",
      voiceProfile: {
        speechStyle: "plain",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "even" },
      environmentAnchor: {
        name: "Test Hub",
        description: "A concurrency test space",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: { relationship: "test", facts: [], summary: "" },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id, name: engramsTable.name });

  const spaces = await db
    .insert(hubSpacesTable)
    .values(
      ["A", "B", "C"].map((suffix) => ({
        ownerId: OWNER_ID,
        slug: `space-${suffix.toLowerCase()}`,
        name: `Space ${suffix}`,
        kind: "commons",
        description: `Space ${suffix}`,
        visibilityScope: "public",
        actionScope: "converse",
        logged: true,
        allowsInitiative: true,
      })),
    )
    .returning();

  return {
    engram,
    spaceA: spaces[0]!,
    spaceB: spaces[1]!,
    spaceC: spaces[2]!,
  };
}

suite("movePresence — concurrent operators", () => {
  it("serializes simultaneous first placements into one enter followed by one move", async () => {
    const { engram, spaceA, spaceB } = await insertFixture();

    const initialPresence = await db
      .select()
      .from(engramPresenceTable)
      .where(eq(engramPresenceTable.engramId, engram.id));
    expect(initialPresence).toHaveLength(0);

    const [placementA, placementB] = await Promise.all([
      movePresence({ ownerId: OWNER_ID, engram, targetSpace: spaceA }),
      movePresence({ ownerId: OWNER_ID, engram, targetSpace: spaceB }),
    ]);

    const [presence] = await db
      .select()
      .from(engramPresenceTable)
      .where(eq(engramPresenceTable.engramId, engram.id));
    const activities = await db
      .select()
      .from(hubActivityLogTable)
      .where(eq(hubActivityLogTable.engramId, engram.id))
      .orderBy(hubActivityLogTable.id);

    expect(activities).toHaveLength(2);
    expect(activities.map((activity) => activity.kind)).toEqual(["enter", "move"]);
    const firstSpaceId = activities[0]?.spaceId;
    const secondSpaceId = activities[1]?.spaceId;
    expect([spaceA.id, spaceB.id]).toContain(firstSpaceId);
    expect([spaceA.id, spaceB.id]).toContain(secondSpaceId);
    expect(secondSpaceId).not.toBe(firstSpaceId);
    expect(activities[0]?.summary).toBe(
      `Concurrent Engram entered ${firstSpaceId === spaceA.id ? spaceA.name : spaceB.name}.`,
    );
    expect(activities[1]?.summary).toBe(
      `Concurrent Engram moved from ${
        firstSpaceId === spaceA.id ? spaceA.name : spaceB.name
      } to ${secondSpaceId === spaceA.id ? spaceA.name : spaceB.name}.`,
    );
    expect(presence?.spaceId).toBe(secondSpaceId);

    const secondCommittedPlacement =
      placementA.spaceId === secondSpaceId ? placementA : placementB;
    expect(presence?.enteredAt).toEqual(secondCommittedPlacement.enteredAt);
    expect(presence?.updatedAt).toEqual(secondCommittedPlacement.updatedAt);
  });

  it("chains concurrent moves from the actual committed previous space", async () => {
    const { engram, spaceA, spaceB, spaceC } = await insertFixture();
    await movePresence({ ownerId: OWNER_ID, engram, targetSpace: spaceA });

    await Promise.all([
      movePresence({ ownerId: OWNER_ID, engram, targetSpace: spaceB }),
      movePresence({ ownerId: OWNER_ID, engram, targetSpace: spaceC }),
    ]);

    const [presence] = await db
      .select()
      .from(engramPresenceTable)
      .where(eq(engramPresenceTable.engramId, engram.id));
    const activities = await db
      .select()
      .from(hubActivityLogTable)
      .orderBy(hubActivityLogTable.id);

    expect([spaceB.id, spaceC.id]).toContain(presence?.spaceId);
    expect(activities.map((activity) => activity.summary)).toHaveLength(3);

    const moveSummaries = activities.slice(1).map((activity) => activity.summary);
    expect([
      [
        "Concurrent Engram moved from Space A to Space B.",
        "Concurrent Engram moved from Space B to Space C.",
      ],
      [
        "Concurrent Engram moved from Space A to Space C.",
        "Concurrent Engram moved from Space C to Space B.",
      ],
    ]).toContainEqual(moveSummaries);
  });
});