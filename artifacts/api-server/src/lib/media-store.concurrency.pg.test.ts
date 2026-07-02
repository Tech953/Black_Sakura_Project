import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";

/**
 * Media-queue concurrency proof against a REAL, multi-connection Postgres.
 *
 * The sibling `media-store.db.test.ts` runs on in-memory PGlite, which serializes
 * every transaction on a single connection — so its `Promise.all` "races" only
 * ever validate the OUTCOME, never the actual `FOR UPDATE SKIP LOCKED` locking
 * under genuine contention. If the skip-locked clause or the status guard were
 * dropped, those PGlite tests would very likely still pass.
 *
 * This file instead points the real `node-postgres` driver (a pooled, many-
 * connection client) at the live Postgres, so two claims/requeues fired with
 * `Promise.all` land on SEPARATE backends and the row lock is truly contended.
 * To avoid touching any real data we run inside a throwaway, uniquely-named
 * schema (pinned via the libpq `options=-c search_path=...` connection param set
 * BEFORE `@workspace/db` loads), migrate the full schema into it, and drop it in
 * teardown. When no `DATABASE_URL` is configured the whole suite is skipped.
 */
const { hasPg, testSchema } = vi.hoisted(() => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    // No real Postgres available: pin PGlite so importing @workspace/db doesn't
    // throw at module load, then skip every test below.
    process.env.ENGRAM_DB_DRIVER = "pglite";
    delete process.env.PGLITE_DATA_DIR;
    return { hasPg: false, testSchema: "" };
  }
  // Force the real multi-connection driver...
  process.env.ENGRAM_DB_DRIVER = "node-postgres";
  delete process.env.PGLITE_DATA_DIR;
  // ...and confine every pooled connection to a throwaway schema so this suite
  // never reads or mutates real rows. `\w`-only name => safe to interpolate.
  const schema = `media_conc_test_${process.pid}_${Date.now()}`;
  const url = new URL(databaseUrl);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  process.env.DATABASE_URL = url.toString();
  return { hasPg: true, testSchema: schema };
});

import { db, pool, closeDb, mediaAssetsTable } from "@workspace/db";
import type { MediaJobStatus } from "@workspace/db/schema";
import { sql, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  claimNextPendingJob,
  requeueMediaAsset,
} from "./media-store";

// The generated Drizzle SQL migrations live at the repo root under lib/db/drizzle.
// This test file is at artifacts/api-server/src/lib, so climb four levels out.
const MIGRATIONS_FOLDER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../lib/db/drizzle",
);

const suite = describe.skipIf(!hasPg);

/** Insert one media-asset row directly and return its id. */
async function insertAsset(status: MediaJobStatus): Promise<number> {
  const [row] = await db
    .insert(mediaAssetsTable)
    .values({
      engramId: null,
      conversationId: null,
      filename: "asset.txt",
      mimeType: "text/plain",
      modality: "text",
      sizeBytes: 1,
      status,
      ...(status === "processing" ? { startedAt: new Date() } : {}),
    })
    .returning({ id: mediaAssetsTable.id });
  return row.id;
}

async function statusOf(id: number): Promise<MediaJobStatus | undefined> {
  const [row] = await db
    .select({ status: mediaAssetsTable.status })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id));
  return row?.status as MediaJobStatus | undefined;
}

async function pendingCount(): Promise<number> {
  const rows = await db
    .select({ id: mediaAssetsTable.id })
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.status, "pending"));
  return rows.length;
}

beforeAll(async () => {
  if (!hasPg) return;
  // Create the throwaway schema, then migrate the whole app schema into it. We
  // point the migrator's own bookkeeping table at the same throwaway schema so a
  // dev DB that already ran these migrations (tracked in the default `drizzle`
  // schema) can't make the migrator skip them here — this schema starts empty,
  // so every migration always runs into it.
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "${testSchema}"`));
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: testSchema,
    migrationsTable: "__drizzle_migrations",
  });
});

beforeEach(async () => {
  if (!hasPg) return;
  await db.delete(mediaAssetsTable);
});

afterAll(async () => {
  if (hasPg) {
    await db.execute(sql.raw(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`));
  }
  await closeDb();
});

suite("claimNextPendingJob — contended on a real multi-connection Postgres", () => {
  it("yields a single pending row to exactly one of many concurrent claimers", async () => {
    const id = await insertAsset("pending");

    // Fire many claims at once. On a real pool each opens its own backend, so
    // `FOR UPDATE` genuinely contends for the one row: exactly one transaction
    // may claim it. Without any row lock, every claimer would read it as pending
    // and UPDATE it to processing — producing multiple "winners" (double
    // processing). This assertion fails in that regression.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => claimNextPendingJob()),
    );

    const winners = results.filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.status).toBe("processing");
    expect(await statusOf(id)).toBe("processing");
    expect(await pendingCount()).toBe(0);
  });

  it("hands N concurrent claimers N distinct rows — never the same upload twice", async () => {
    const ids = new Set<number>();
    for (let i = 0; i < 6; i += 1) ids.add(await insertAsset("pending"));

    // Six pending rows, six simultaneous claimers on separate connections. Every
    // claimer must get a DISTINCT row and none may be left unclaimed or claimed
    // twice — the core guarantee that two workers never process one upload.
    const results = await Promise.all(
      Array.from({ length: 6 }, () => claimNextPendingJob()),
    );

    const claimedIds = results.map((r) => r?.id).filter((x): x is number => x != null);
    expect(claimedIds).toHaveLength(6);
    // No duplicates: a Set of the claimed ids is the same size as the list.
    expect(new Set(claimedIds).size).toBe(6);
    // ...and they are exactly the rows we inserted.
    expect(new Set(claimedIds)).toEqual(ids);
    expect(await pendingCount()).toBe(0);
  });

  it("SKIP LOCKED skips an already-locked row instead of blocking on it", async () => {
    await insertAsset("pending");

    // Hold an explicit row lock on the only pending row from a SEPARATE
    // connection, mimicking a worker mid-claim. With SKIP LOCKED, a concurrent
    // `claimNextPendingJob()` must see the locked row, skip it, find nothing else
    // pending, and return undefined WITHOUT waiting for us to release. If the
    // SKIP LOCKED clause were removed, the claim would block on our lock and this
    // await would hang until the test times out — i.e. the regression fails here.
    const holder = await pool!.connect();
    try {
      await holder.query("BEGIN");
      await holder.query(
        `SELECT id FROM "${testSchema}".media_assets
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE`,
      );

      const claimed = await claimNextPendingJob();
      expect(claimed).toBeUndefined();
    } finally {
      await holder.query("ROLLBACK");
      holder.release();
    }
  });
});

suite("requeueMediaAsset — contended on a real multi-connection Postgres", () => {
  it("lets exactly one of many concurrent requeues win the failed→pending flip", async () => {
    const id = await insertAsset("failed");

    // The `status = 'failed'` guard lives inside the UPDATE, so on a real DB only
    // the first committed requeue matches the row; every other concurrent requeue
    // now sees status = 'pending', updates zero rows, and returns undefined. Drop
    // that guard and all of them would succeed (multiple winners) — failing here.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => requeueMediaAsset(id)),
    );

    const winners = results.filter((r) => r !== undefined);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.id).toBe(id);
    expect(winners[0]!.status).toBe("pending");
    expect(await statusOf(id)).toBe("pending");
  });
});
