import { pgTable, serial, text, real, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const journalTable = pgTable("journal", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  event: text("event").notNull(),
  confidence: real("confidence").notNull(),
  reflection: text("reflection").notNull(),
  actionItems: text("action_items").notNull(),
  outcome: text("outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("journal_owner_idx").on(t.ownerId)]);

export const insertJournalSchema = createInsertSchema(journalTable).omit({ id: true, createdAt: true });
export type InsertJournal = z.infer<typeof insertJournalSchema>;
export type Journal = typeof journalTable.$inferSelect;
