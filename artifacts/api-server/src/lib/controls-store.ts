import { db, type AppDatabase } from "@workspace/db";
import { hubControlsTable } from "@workspace/db/schema";
import type { HubControls } from "@workspace/db";
import { eq } from "drizzle-orm";
import { publishEvent } from "./events";

const controlUpdateTails = new Map<string, Promise<void>>();

async function withControlUpdateLock<T>(
  ownerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = controlUpdateTails.get(ownerId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  controlUpdateTails.set(ownerId, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (controlUpdateTails.get(ownerId) === tail) {
      controlUpdateTails.delete(ownerId);
    }
  }
}

/**
 * Bind controls operations to a database handle. The per-owner queue is shared
 * across handles so concurrent requests retain event ordering even when they
 * are served through different PostgreSQL sessions.
 */
export function createControlsStore(database: AppDatabase) {
  /**
   * Load an account's controls row, creating its defaults on first access.
   */
  async function loadControls(ownerId: string): Promise<HubControls> {
    const [existing] = await database
      .select()
      .from(hubControlsTable)
      .where(eq(hubControlsTable.ownerId, ownerId));
    if (existing) return existing;

    const [created] = await database
      .insert(hubControlsTable)
      .values({ ownerId })
      .onConflictDoNothing()
      .returning();
    if (created) return created;

    // Lost an insert race — re-read.
    const [row] = await database
      .select()
      .from(hubControlsTable)
      .where(eq(hubControlsTable.ownerId, ownerId));
    if (row) return row;

    // A failed/rolled-back first-write must never take down the engine or the
    // group-chat policy gate. These are the schema defaults, represented as a
    // transient row until the next successful write can materialize them.
    return {
      id: 0,
      ownerId,
      paused: false,
      quietMode: false,
      updatedAt: new Date(),
    };
  }

  /** Update one or both global-control flags and stamp updatedAt. */
  async function updateControls(
    ownerId: string,
    patch: { paused?: boolean; quietMode?: boolean },
  ): Promise<HubControls> {
    return withControlUpdateLock(ownerId, async () => {
      await loadControls(ownerId);
      const update: { paused?: boolean; quietMode?: boolean; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (patch.paused !== undefined) update.paused = patch.paused;
      if (patch.quietMode !== undefined) update.quietMode = patch.quietMode;
      const [row] = await database
        .update(hubControlsTable)
        .set(update)
        .where(eq(hubControlsTable.ownerId, ownerId))
        .returning();
      publishEvent({ type: "controls.changed", ownerId, data: row });
      return row;
    });
  }

  return { loadControls, updateControls };
}

const controlsStore = createControlsStore(db);
export const { loadControls, updateControls } = controlsStore;
