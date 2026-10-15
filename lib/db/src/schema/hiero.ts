import { pgTable, serial, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hieroTable = pgTable("hiero_symbols", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  glyph: text("glyph").notNull().unique(),
  name: text("name").notNull(),
  meaning: text("meaning").notNull(),
  category: text("category").notNull(),
  compounds: text("compounds"),
}, (t) => [index("hiero_owner_idx").on(t.ownerId)]);

export const insertHieroSchema = createInsertSchema(hieroTable).omit({ id: true });
export type InsertHiero = z.infer<typeof insertHieroSchema>;
export type Hiero = typeof hieroTable.$inferSelect;
