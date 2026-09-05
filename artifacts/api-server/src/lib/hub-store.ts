import { db } from "@workspace/db";
import {
  hubSpacesTable,
  engramPresenceTable,
  hubActivityLogTable,
  engramsTable,
} from "@workspace/db/schema";
import type { HubSpace, EngramPresence, HubActivity, HubActivityKind } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { statusForSpace, describeMovement } from "./hub";

const ACTIVITY_DEFAULT_LIMIT = 50;
const ACTIVITY_MAX_LIMIT = 200;

export async function loadSpaces(ownerId: string): Promise<HubSpace[]> {
  return db
    .select()
    .from(hubSpacesTable)
    .where(eq(hubSpacesTable.ownerId, ownerId))
    .orderBy(hubSpacesTable.sortOrder);
}

export async function loadSpaceById(id: number, ownerId: string): Promise<HubSpace | undefined> {
  const [row] = await db
    .select()
    .from(hubSpacesTable)
    .where(and(eq(hubSpacesTable.id, id), eq(hubSpacesTable.ownerId, ownerId)));
  return row;
}

export async function loadPresence(ownerId: string): Promise<EngramPresence[]> {
  const rows = await db
    .select({ presence: engramPresenceTable })
    .from(engramPresenceTable)
    .innerJoin(hubSpacesTable, eq(engramPresenceTable.spaceId, hubSpacesTable.id))
    .innerJoin(engramsTable, eq(engramPresenceTable.engramId, engramsTable.id))
    .where(and(eq(hubSpacesTable.ownerId, ownerId), eq(engramsTable.ownerId, ownerId)));
  return rows.map(({ presence }) => presence);
}

export async function loadPresenceForEngram(
  engramId: number,
  ownerId: string,
): Promise<EngramPresence | undefined> {
  const [row] = await db
    .select({ presence: engramPresenceTable })
    .from(engramPresenceTable)
    .innerJoin(hubSpacesTable, eq(engramPresenceTable.spaceId, hubSpacesTable.id))
    .innerJoin(engramsTable, eq(engramPresenceTable.engramId, engramsTable.id))
    .where(
      and(
        eq(engramPresenceTable.engramId, engramId),
        eq(hubSpacesTable.ownerId, ownerId),
        eq(engramsTable.ownerId, ownerId),
      ),
    );
  return row?.presence;
}

export async function loadActivity(
  ownerId: string,
  opts: { spaceId?: number; limit?: number } = {},
): Promise<HubActivity[]> {
  const limit = Math.min(
    Math.max(opts.limit ?? ACTIVITY_DEFAULT_LIMIT, 1),
    ACTIVITY_MAX_LIMIT,
  );
  const rows = await db
    .select({ activity: hubActivityLogTable })
    .from(hubActivityLogTable)
    .innerJoin(hubSpacesTable, eq(hubActivityLogTable.spaceId, hubSpacesTable.id))
    .where(
      and(
        eq(hubSpacesTable.ownerId, ownerId),
        ...(opts.spaceId === undefined ? [] : [eq(hubActivityLogTable.spaceId, opts.spaceId)]),
      ),
    )
    .orderBy(desc(hubActivityLogTable.createdAt))
    .limit(limit);
  return rows.map(({ activity }) => activity);
}

export async function appendActivity(entry: {
  ownerId: string;
  spaceId: number;
  engramId?: number | null;
  kind: HubActivityKind;
  summary: string;
}): Promise<HubActivity> {
  const space = await loadSpaceById(entry.spaceId, entry.ownerId);
  if (!space) throw new Error("Cannot append activity to a foreign or missing Hub space");
  if (entry.engramId != null) {
    const [engram] = await db
      .select({ id: engramsTable.id })
      .from(engramsTable)
      .where(and(eq(engramsTable.id, entry.engramId), eq(engramsTable.ownerId, entry.ownerId)));
    if (!engram) throw new Error("Cannot append activity for a foreign or missing engram");
  }
  const [row] = await db
    .insert(hubActivityLogTable)
    .values({
      spaceId: entry.spaceId,
      engramId: entry.engramId ?? null,
      kind: entry.kind,
      summary: entry.summary,
    })
    .returning();
  return row;
}

/**
 * Move (or first-place) an engram into a space. Transactional: the presence
 * upsert and the archive entry succeed or fail together. `enteredAt` only resets
 * when the engram actually changes spaces. Movement is logged only when the
 * source or target space has logging enabled (and only on a real space change).
 */
export async function movePresence(args: {
  ownerId: string;
  engram: { id: number; name: string };
  targetSpace: HubSpace;
  note?: string | null;
}): Promise<EngramPresence> {
  const { ownerId, engram, targetSpace, note } = args;
  const status = statusForSpace(targetSpace);
  const now = new Date();

  return db.transaction(async (tx) => {
    const [ownedEngram] = await tx
      .select({ id: engramsTable.id })
      .from(engramsTable)
      .where(and(eq(engramsTable.id, engram.id), eq(engramsTable.ownerId, ownerId)));
    if (!ownedEngram) throw new Error("Cannot move presence for a foreign or missing engram");

    const [ownedTarget] = await tx
      .select({ id: hubSpacesTable.id })
      .from(hubSpacesTable)
      .where(and(eq(hubSpacesTable.id, targetSpace.id), eq(hubSpacesTable.ownerId, ownerId)));
    if (!ownedTarget) throw new Error("Cannot move presence into a foreign or missing Hub space");

    const [previous] = await tx
      .select()
      .from(engramPresenceTable)
      .where(eq(engramPresenceTable.engramId, engram.id));

    let previousSpace: HubSpace | undefined;
    if (previous) {
      [previousSpace] = await tx
        .select()
        .from(hubSpacesTable)
        .where(and(eq(hubSpacesTable.id, previous.spaceId), eq(hubSpacesTable.ownerId, ownerId)));
    }

    const sameSpace = previous?.spaceId === targetSpace.id;

    const [presence] = await tx
      .insert(engramPresenceTable)
      .values({
        engramId: engram.id,
        spaceId: targetSpace.id,
        status,
        note: note ?? null,
        enteredAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: engramPresenceTable.engramId,
        set: {
          spaceId: targetSpace.id,
          status,
          note: note ?? null,
          ...(sameSpace ? {} : { enteredAt: now }),
          updatedAt: now,
        },
      })
      .returning();

    const shouldLog =
      !sameSpace && (targetSpace.logged || (previousSpace?.logged ?? false));
    if (shouldLog) {
      const { kind, summary } = describeMovement(
        engram.name,
        { name: targetSpace.name, allowsInitiative: targetSpace.allowsInitiative },
        previousSpace
          ? { name: previousSpace.name, allowsInitiative: previousSpace.allowsInitiative }
          : null,
      );
      await tx.insert(hubActivityLogTable).values({
        spaceId: targetSpace.id,
        engramId: engram.id,
        kind,
        summary,
      });
    }

    return presence;
  });
}
