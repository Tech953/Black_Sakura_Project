import { pgTable, serial, text, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const expressionsTable = pgTable("expressions", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  glyph: text("glyph").notNull().unique(),
  name: text("name").notNull(),
  family: text("family").notNull(),
  eyes: text("eyes").notNull(),
  mouth: text("mouth").notNull(),
  gesture: text("gesture"),
  valence: text("valence").notNull(),
  arousal: text("arousal").notNull(),
  intimacy: integer("intimacy").notNull().default(0),
  cognitiveRole: text("cognitive_role"),
  notes: text("notes").notNull(),
}, (t) => [index("expressions_owner_idx").on(t.ownerId)]);

export const insertExpressionSchema = createInsertSchema(expressionsTable).omit({ id: true });
export type InsertExpression = z.infer<typeof insertExpressionSchema>;
export type Expression = typeof expressionsTable.$inferSelect;
