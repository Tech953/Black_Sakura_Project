import { pgTable, serial, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { SYSTEM_OWNER_ID } from "./accounts";

/**
 * Runtime overrides for one account's autonomy engine — one row per owner.
 * `paused` stops ALL engine initiative immediately (engrams still accrue pressure
 * but emit nothing). `quietMode` blocks engram-initiated human contact globally
 * while leaving engram-to-engram conversation untouched. Read once per engine tick
 * and enforced by pure policy before any model call.
 */
export const hubControlsTable = pgTable(
  "hub_controls",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id").notNull().default(SYSTEM_OWNER_ID),
    paused: boolean("paused").notNull().default(false),
    quietMode: boolean("quiet_mode").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("hub_controls_owner_unique").on(t.ownerId)],
);

export const insertHubControlsSchema = createInsertSchema(hubControlsTable).omit({
  updatedAt: true,
});
export type InsertHubControls = z.infer<typeof insertHubControlsSchema>;
export type HubControls = typeof hubControlsTable.$inferSelect;
export type NewHubControls = typeof hubControlsTable.$inferInsert;
