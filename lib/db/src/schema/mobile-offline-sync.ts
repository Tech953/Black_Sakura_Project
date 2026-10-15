import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Idempotency ledger for offline mobile imports. The phone keeps local row IDs
 * stable, while this table maps each device-scoped sync ID to the server row
 * created for it. A retried request therefore acknowledges the existing row
 * instead of inserting a duplicate.
 */
export const mobileOfflineSyncReceiptsTable = pgTable(
  "mobile_offline_sync_receipts",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull().default("__engram_system_template__"),
    deviceId: text("device_id").notNull(),
    syncId: text("sync_id").notNull(),
    kind: text("kind").notNull(),
    remoteId: integer("remote_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("mobile_offline_sync_device_sync_unique").on(
      table.ownerId,
      table.deviceId,
      table.syncId,
    ),
  ],
);

export type MobileOfflineSyncReceipt =
  typeof mobileOfflineSyncReceiptsTable.$inferSelect;