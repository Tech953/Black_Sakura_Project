import { describe, expect, it } from "vitest";
import {
  assertDbHarnessContract,
  createDbHarness,
  engineHarness,
  routeHarness,
} from "./db-harness";

describe("API test database harness contract", () => {
  it("reports required schema and builder capabilities directly", () => {
    expect(() => assertDbHarnessContract(routeHarness)).not.toThrow();
    expect(() => assertDbHarnessContract(engineHarness)).not.toThrow();
  });

  it("supports owner joins, projections, subquery predicates, and async push-token writes", async () => {
    const harness = createDbHarness();
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
});