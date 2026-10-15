import { pgTable, serial, real, timestamp, text, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personalityTable = pgTable("personality", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  curiosity: real("curiosity").notNull().default(0.82),
  humor: real("humor").notNull().default(0.31),
  stoicism: real("stoicism").notNull().default(0.90),
  empathy: real("empathy").notNull().default(0.84),
  formality: real("formality").notNull().default(0.65),
  skepticism: real("skepticism").notNull().default(0.77),
  creativity: real("creativity").notNull().default(0.59),
  initiative: real("initiative").notNull().default(0.55),
  precision: real("precision").notNull().default(0.88),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [index("personality_owner_idx").on(table.ownerId)]);

export const insertPersonalitySchema = createInsertSchema(personalityTable).omit({ id: true, updatedAt: true });
export type InsertPersonality = z.infer<typeof insertPersonalitySchema>;
export type Personality = typeof personalityTable.$inferSelect;
