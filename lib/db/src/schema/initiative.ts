import { pgTable, serial, text, real, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const initiativeTable = pgTable("initiative", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  trigger: text("trigger").notNull(),
  message: text("message").notNull(),
  importanceScore: real("importance_score").notNull(),
  confidenceScore: real("confidence_score").notNull(),
  noveltyScore: real("novelty_score").notNull(),
  overallScore: real("overall_score").notNull(),
  wasDelivered: boolean("was_delivered").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("initiative_owner_idx").on(t.ownerId)]);

export const insertInitiativeSchema = createInsertSchema(initiativeTable).omit({ id: true, createdAt: true });
export type InsertInitiative = z.infer<typeof insertInitiativeSchema>;
export type Initiative = typeof initiativeTable.$inferSelect;
