import { db } from "@workspace/db";
import { hubControlsTable } from "@workspace/db/schema";
import type { HubControls } from "@workspace/db";
import { eq } from "drizzle-orm";
import { publishEvent } from "./events";

/**
 * Load an account's controls row, creating its defaults on first access.
 */
export async function loadControls(ownerId: string): Promise<HubControls> {
  const [existing] = await db
    .select()
    .from(hubControlsTable)
    .where(eq(hubControlsTable.ownerId, ownerId));
  if (existing) return existing;

  const [created] = await db
    .insert(hubControlsTable)
    .values({ ownerId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost an insert race — re-read.
  const [row] = await db
    .select()
    .from(hubControlsTable)
    .where(eq(hubControlsTable.ownerId, ownerId));
  return row;
}

/** Update one or both global-control flags and stamp updatedAt. */
export async function updateControls(
  ownerId: string,
  patch: { paused?: boolean; quietMode?: boolean },
): Promise<HubControls> {
  await loadControls(ownerId);
  const [row] = await db
    .update(hubControlsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(hubControlsTable.ownerId, ownerId))
    .returning();
  publishEvent({ type: "controls.changed", ownerId, data: row });
  return row;
}
