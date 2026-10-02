import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Use a fresh in-memory Postgres so these tests exercise the real transaction,
// ownership, upsert, and activity-log behavior of the Hub store.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
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
import { eq, sql } from "drizzle-orm";
import { findHubPresenceOwnershipIssues, movePresence } from "./hub-store";

const OWNER_ID = "hub-store-movement-owner";
const FOREIGN_OWNER_ID = "hub-store-foreign-owner";

const ready = ensureDatabaseReady({ seed: false });

beforeEach(async () => {
  await ready;
  await db.delete(hubActivityLogTable);
  await db.delete(engramPresenceTable);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
});

afterAll(async () => {
  await closeDb();
});

async function insertEngram(
  name = "Arezo",
  ownerId = OWNER_ID,
): Promise<{ id: number; name: string }> {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId,
      slug: `movement-${name.toLowerCase()}-${Date.now()}-${Math.random()}`,
      name,
      title: "Movement test engram",
      symbol: "◆",
      origin: "Hub movement test",
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
        description: "A test space",
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
  return row;
}

async function insertSpace(args: {
  slug: string;
  name: string;
  logged: boolean;
  allowsInitiative: boolean;
  ownerId?: string;
}) {
  const [row] = await db
    .insert(hubSpacesTable)
    .values({
      ownerId: args.ownerId ?? OWNER_ID,
      slug: args.slug,
      name: args.name,
      kind: args.allowsInitiative ? "commons" : "quiescence",
      description: `${args.name} for movement tests`,
      visibilityScope: "public",
      actionScope: args.allowsInitiative ? "converse" : "rest",
      logged: args.logged,
      allowsInitiative: args.allowsInitiative,
    })
    .returning();
  return row;
}

async function activityRows() {
  return db
    .select()
    .from(hubActivityLogTable)
    .orderBy(hubActivityLogTable.id);
}

async function presenceRows() {
  return db
    .select()
    .from(engramPresenceTable)
    .orderBy(engramPresenceTable.id);
}

async function insertPresence(engramId: number, spaceId: number) {
  const [row] = await db
    .insert(engramPresenceTable)
    .values({ engramId, spaceId })
    .returning();
  return row;
}

describe("movePresence — first placement and same-space updates", () => {
  it("logs an enter event for a first placement", async () => {
    const engram = await insertEngram();
    const commons = await insertSpace({
      slug: "commons",
      name: "The Commons",
      logged: true,
      allowsInitiative: true,
    });

    const presence = await movePresence({
      ownerId: OWNER_ID,
      engram,
      targetSpace: commons,
      note: "arrived",
    });

    expect(presence).toMatchObject({
      engramId: engram.id,
      spaceId: commons.id,
      status: "active",
      note: "arrived",
    });
    expect(presence.enteredAt).toBeInstanceOf(Date);
    await expect(activityRows()).resolves.toEqual([
      expect.objectContaining({
        spaceId: commons.id,
        engramId: engram.id,
        kind: "enter",
        summary: "Arezo entered The Commons.",
      }),
    ]);
  });

  it("updates a same-space presence without logging or resetting enteredAt", async () => {
    const engram = await insertEngram();
    const commons = await insertSpace({
      slug: "commons",
      name: "The Commons",
      logged: true,
      allowsInitiative: true,
    });

    const first = await movePresence({
      ownerId: OWNER_ID,
      engram,
      targetSpace: commons,
      note: "first note",
    });
    const second = await movePresence({
      ownerId: OWNER_ID,
      engram,
      targetSpace: commons,
      note: "updated note",
    });

    expect(second).toMatchObject({
      id: first.id,
      engramId: engram.id,
      spaceId: commons.id,
      status: "active",
      note: "updated note",
      enteredAt: first.enteredAt,
    });
    expect((await activityRows()).map((activity) => activity.kind)).toEqual(["enter"]);
  });
});

describe("movePresence — logging rules", () => {
  it("logs only when the source or target space is logged", async () => {
    const engram = await insertEngram();
    const unloggedA = await insertSpace({
      slug: "private-a",
      name: "Private A",
      logged: false,
      allowsInitiative: true,
    });
    const unloggedB = await insertSpace({
      slug: "private-b",
      name: "Private B",
      logged: false,
      allowsInitiative: true,
    });
    const logged = await insertSpace({
      slug: "commons",
      name: "The Commons",
      logged: true,
      allowsInitiative: true,
    });

    await movePresence({ ownerId: OWNER_ID, engram, targetSpace: unloggedA });
    await movePresence({ ownerId: OWNER_ID, engram, targetSpace: unloggedB });
    expect(await activityRows()).toHaveLength(0);

    await movePresence({ ownerId: OWNER_ID, engram, targetSpace: logged });
    expect((await activityRows()).map((activity) => activity.kind)).toEqual(["move"]);

    await movePresence({ ownerId: OWNER_ID, engram, targetSpace: unloggedA });
    expect((await activityRows()).map((activity) => activity.kind)).toEqual(["move", "move"]);
  });
});

describe("movePresence — activity transaction atomicity", () => {
  it("rolls back the presence update when the activity insert fails", async () => {
    const engram = await insertEngram();
    const source = await insertSpace({
      slug: "atomic-source",
      name: "Atomic Source",
      logged: true,
      allowsInitiative: true,
    });
    const target = await insertSpace({
      slug: "atomic-target",
      name: "Atomic Target",
      logged: true,
      allowsInitiative: true,
    });
    const initialPresence = await movePresence({
      ownerId: OWNER_ID,
      engram,
      targetSpace: source,
      note: "before failed move",
    });
    const beforePresence = await presenceRows();
    const beforeActivity = await activityRows();
    const constraintName = "hub_store_activity_failure_test";

    await db.execute(
      sql.raw(
        `ALTER TABLE "hub_activity_log" ADD CONSTRAINT "${constraintName}" CHECK (summary <> 'Arezo moved from Atomic Source to Atomic Target.')`,
      ),
    );
    try {
      await expect(
        movePresence({
          ownerId: OWNER_ID,
          engram,
          targetSpace: target,
          note: "should not persist",
        }),
      ).rejects.toThrow();
    } finally {
      await db.execute(
        sql.raw(`ALTER TABLE "hub_activity_log" DROP CONSTRAINT "${constraintName}"`),
      );
    }

    expect(await presenceRows()).toEqual(beforePresence);
    expect(await activityRows()).toEqual(beforeActivity);
    expect((await presenceRows()).find((row) => row.engramId === engram.id)).toMatchObject({
      id: initialPresence.id,
      spaceId: source.id,
      note: "before failed move",
      enteredAt: initialPresence.enteredAt,
    });
  });
});

describe("movePresence — rest and wake classification", () => {
  it("classifies entering a rest space as rest and leaving it as wake", async () => {
    const engram = await insertEngram();
    const commons = await insertSpace({
      slug: "commons",
      name: "The Commons",
      logged: true,
      allowsInitiative: true,
    });
    const quiescence = await insertSpace({
      slug: "quiescence",
      name: "Quiescence",
      logged: true,
      allowsInitiative: false,
    });

    const first = await movePresence({ ownerId: OWNER_ID, engram, targetSpace: commons });
    const resting = await movePresence({
      ownerId: OWNER_ID,
      engram,
      targetSpace: quiescence,
    });
    const awake = await movePresence({ ownerId: OWNER_ID, engram, targetSpace: commons });

    expect(first.status).toBe("active");
    expect(resting.status).toBe("resting");
    expect(awake.status).toBe("active");
    expect((await activityRows()).map((activity) => activity.kind)).toEqual([
      "enter",
      "rest",
      "wake",
    ]);
  });
});

describe("movePresence — ownership boundaries", () => {
  it("rejects a foreign engram without changing presence or activity", async () => {
    const foreignEngram = await insertEngram("Foreign", FOREIGN_OWNER_ID);
    const targetSpace = await insertSpace({
      slug: "owned-target",
      name: "Owned Target",
      logged: true,
      allowsInitiative: true,
    });
    const beforePresence = await presenceRows();
    const beforeActivity = await activityRows();

    await expect(
      movePresence({
        ownerId: OWNER_ID,
        engram: foreignEngram,
        targetSpace,
      }),
    ).rejects.toThrow("foreign or missing engram");

    expect(await presenceRows()).toEqual(beforePresence);
    expect(await activityRows()).toEqual(beforeActivity);
  });

  it("rejects a foreign target space without changing presence or activity", async () => {
    const engram = await insertEngram();
    const foreignSpace = await insertSpace({
      slug: "foreign-target",
      name: "Foreign Target",
      logged: true,
      allowsInitiative: true,
      ownerId: FOREIGN_OWNER_ID,
    });
    const beforePresence = await presenceRows();
    const beforeActivity = await activityRows();

    await expect(
      movePresence({
        ownerId: OWNER_ID,
        engram,
        targetSpace: foreignSpace,
      }),
    ).rejects.toThrow("foreign or missing Hub space");

    expect(await presenceRows()).toEqual(beforePresence);
    expect(await activityRows()).toEqual(beforeActivity);
  });
});

describe("findHubPresenceOwnershipIssues", () => {
  it("returns no findings for a valid same-owner presence row without mutating it", async () => {
    const engram = await insertEngram();
    const space = await insertSpace({
      slug: "diagnostic-owned-space",
      name: "Owned Space",
      logged: true,
      allowsInitiative: true,
    });
    await insertPresence(engram.id, space.id);
    const before = await presenceRows();

    await expect(findHubPresenceOwnershipIssues()).resolves.toEqual([]);
    expect(await presenceRows()).toEqual(before);
  });

  it("reports both owner-mismatch directions and their IDs without mutating rows", async () => {
    const ownedEngram = await insertEngram("Owned");
    const foreignEngram = await insertEngram("Foreign", FOREIGN_OWNER_ID);
    const ownedSpace = await insertSpace({
      slug: "diagnostic-owned-space",
      name: "Owned Space",
      logged: true,
      allowsInitiative: true,
    });
    const foreignSpace = await insertSpace({
      slug: "diagnostic-foreign-space",
      name: "Foreign Space",
      logged: true,
      allowsInitiative: true,
      ownerId: FOREIGN_OWNER_ID,
    });
    const ownedEngramInForeignSpace = await insertPresence(ownedEngram.id, foreignSpace.id);
    const foreignEngramInOwnedSpace = await insertPresence(foreignEngram.id, ownedSpace.id);
    const before = await presenceRows();

    await expect(findHubPresenceOwnershipIssues()).resolves.toEqual([
      {
        presenceId: ownedEngramInForeignSpace.id,
        engramId: ownedEngram.id,
        engramOwnerId: OWNER_ID,
        spaceId: foreignSpace.id,
        spaceOwnerId: FOREIGN_OWNER_ID,
      },
      {
        presenceId: foreignEngramInOwnedSpace.id,
        engramId: foreignEngram.id,
        engramOwnerId: FOREIGN_OWNER_ID,
        spaceId: ownedSpace.id,
        spaceOwnerId: OWNER_ID,
      },
    ]);
    expect(await presenceRows()).toEqual(before);
  });
});