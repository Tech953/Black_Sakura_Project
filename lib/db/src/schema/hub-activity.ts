import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";
import { hubSpacesTable } from "./hub-spaces";

/** The kind of Hub event recorded in the archive. */
export const HUB_ACTIVITY_KINDS = [
  "enter",
  "move",
  "rest",
  "wake",
  "converse",
  "simulate",
  "system",
] as const;
export type HubActivityKind = (typeof HUB_ACTIVITY_KINDS)[number];

/**
 * The Hub's append-only activity archive. Movements and notable events are
 * recorded here (only for spaces whose `logged` flag is set). `engramId` is
 * nullable so purely systemic events can be recorded without an actor.
 */
export const hubActivityLogTable = pgTable(
  "hub_activity_log",
  {
    id: serial("id").primaryKey(),
    spaceId: integer("space_id")
      .notNull()
      .references(() => hubSpacesTable.id, { onDelete: "cascade" }),
    engramId: integer("engram_id").references(() => engramsTable.id, {
      onDelete: "cascade",
    }),
    /** One of HUB_ACTIVITY_KINDS. */
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("hub_activity_space_created_idx").on(t.spaceId, t.createdAt),
    index("hub_activity_engram_created_idx").on(t.engramId, t.createdAt),
  ],
);

export const insertHubActivitySchema = createInsertSchema(hubActivityLogTable).omit({
  id: true,
  createdAt: true,
});
export type InsertHubActivity = z.infer<typeof insertHubActivitySchema>;
export type HubActivity = typeof hubActivityLogTable.$inferSelect;
export type NewHubActivity = typeof hubActivityLogTable.$inferInsert;
