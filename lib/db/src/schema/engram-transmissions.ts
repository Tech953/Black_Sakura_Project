import {
  pgTable,
  serial,
  integer,
  text,
  real,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";

/** A self-initiated message produced autonomously by an engram (idle monologue or directed outreach). */
export const engramTransmissionsTable = pgTable("engram_transmissions", {
  id: serial("id").primaryKey(),
  engramId: integer("engram_id")
    .notNull()
    .references(() => engramsTable.id, { onDelete: "cascade" }),
  /** "idle" = internal monologue when no user present; "outreach" = directed at the user. */
  kind: text("kind").notNull(),
  /** Originating drive id/label that crossed threshold. */
  drive: text("drive").notNull(),
  content: text("content").notNull(),
  mood: text("mood"),
  importanceScore: real("importance_score").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  noveltyScore: real("novelty_score").notNull(),
  overallScore: real("overall_score").notNull(),
  wasDelivered: boolean("was_delivered").notNull().default(true),
  seen: boolean("seen").notNull().default(false),
  /**
   * Set before handing a delivered outreach to the push provider. The claim
   * prevents an engine retry from sending the same transmission twice.
   */
  pushNotifiedAt: timestamp("push_notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertEngramTransmissionSchema = createInsertSchema(
  engramTransmissionsTable,
).omit({ id: true, createdAt: true });
export type InsertEngramTransmission = z.infer<typeof insertEngramTransmissionSchema>;
export type EngramTransmission = typeof engramTransmissionsTable.$inferSelect;
export type NewEngramTransmission = typeof engramTransmissionsTable.$inferInsert;
