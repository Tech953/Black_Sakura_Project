import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertDbHarnessContract,
  createIsolatedDbHarness,
  engineHarness,
  routeHarness,
} from "./db-harness";

describe("API test database harness contract", () => {
  it("reports required schema and builder capabilities directly", () => {
    expect(() => assertDbHarnessContract(routeHarness)).not.toThrow();
    expect(() => assertDbHarnessContract(engineHarness)).not.toThrow();
  });

  it("supports owner joins, projections, subquery predicates, and async push-token writes", async () => {
    const harness = createIsolatedDbHarness();
    const { schema, drizzle, db, store } = harness;

    store.engramsTable.push(
      { id: 1, ownerId: "owner-a", name: "Owned" },
      { id: 2, ownerId: "owner-b", name: "Foreign" },
    );
    store.engramTransmissionsTable.push(
      { id: 11, engramId: 1, content: "owned transmission" },
      { id: 12, engramId: 2, content: "foreign transmission" },
    );

    const joined = await db
      .select({
        transmissionId: schema.engramTransmissionsTable.id,
        ownerId: schema.engramsTable.ownerId,
        content: schema.engramTransmissionsTable.content,
      })
      .from(schema.engramTransmissionsTable)
      .innerJoin(
        schema.engramsTable,
        drizzle.eq(
          schema.engramTransmissionsTable.engramId,
          schema.engramsTable.id,
        ),
      )
      .where(drizzle.eq(schema.engramsTable.ownerId, "owner-a"));
    expect(joined).toEqual([
      {
        transmissionId: 11,
        ownerId: "owner-a",
        content: "owned transmission",
      },
    ]);

    const ownedEngramIds = db
      .select({ id: schema.engramsTable.id })
      .from(schema.engramsTable)
      .where(drizzle.eq(schema.engramsTable.ownerId, "owner-a"));
    const subqueryFiltered = await db
      .select()
      .from(schema.engramTransmissionsTable)
      .where(
        drizzle.inArray(
          schema.engramTransmissionsTable.engramId,
          ownedEngramIds,
        ),
      );
    expect(subqueryFiltered.map((row) => row.id)).toEqual([11]);

    const [token] = await db
      .insert(schema.mobilePushTokensTable)
      .values({
        ownerId: "owner-a",
        token: "push-token",
        platform: "ios",
        enabled: true,
      })
      .onConflictDoNothing()
      .returning();
    expect(token).toMatchObject({ ownerId: "owner-a", token: "push-token" });

    await db
      .update(schema.mobilePushTokensTable)
      .set({ lastUsedAt: new Date("2026-09-13T00:00:00.000Z") })
      .where(drizzle.eq(schema.mobilePushTokensTable.id, token.id));
    expect(store.mobilePushTokensTable[0]).toMatchObject({
      lastUsedAt: new Date("2026-09-13T00:00:00.000Z"),
    });
  });

  it("keeps independently created module harnesses and assertion logs isolated", async () => {
    const first = createIsolatedDbHarness();
    const second = createIsolatedDbHarness();

    first.store.engramsTable.push({ id: 1, ownerId: "first-owner" });
    first.state.inserts.push({ marker: "first compatibility insert" });
    second.state.updates.push({ marker: "second compatibility update" });

    await first.db
      .insert(first.schema.engramsTable)
      .values({ ownerId: "first-owner" });
    await first.db
      .update(first.schema.engramsTable)
      .set({ name: "First" })
      .where(first.drizzle.eq(first.schema.engramsTable.id, 1));

    expect(second.store.engramsTable).toEqual([]);
    expect(second.insertCalls).toEqual([]);
    expect(second.updateCalls).toEqual([]);
    expect(second.state.inserts).toEqual([]);
    expect(second.state.updates).toEqual([{ marker: "second compatibility update" }]);
    expect(first.insertCalls).not.toBe(first.state.inserts);
    expect(first.updateCalls).not.toBe(first.state.updates);
    expect(first.state.inserts).toHaveLength(2);
    expect(first.state.updates).toHaveLength(1);
  });

  it("keeps harness imports ahead of Vitest-hoisted factories", () => {
    for (const testModule of [
      new URL("../routes/api-routes.test.ts", import.meta.url),
      new URL("../services/engram-engine.test.ts", import.meta.url),
    ]) {
      const source = readFileSync(testModule, "utf8");
      const harnessImport = source.indexOf('from "../test/db-harness"');
      const firstHoistedFactory = Math.min(
        ...["vi.mock(", "vi.hoisted("]
          .map((token) => source.indexOf(token))
          .filter((index) => index >= 0),
      );

      expect(harnessImport).toBeGreaterThanOrEqual(0);
      expect(firstHoistedFactory).toBeGreaterThan(harnessImport);
    }
  });
});