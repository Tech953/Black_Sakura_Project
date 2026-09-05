import { pgTable, serial, text, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const personasTable = pgTable("personas", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  emphasis: text("emphasis").notNull(),
  symbol: text("symbol").notNull(),
  isActive: boolean("is_active").notNull().default(false),
  memoryBias: text("memory_bias").notNull(),
  reasoningStyle: text("reasoning_style").notNull(),
}, (t) => [index("personas_owner_idx").on(t.ownerId)]);

export const insertPersonaSchema = createInsertSchema(personasTable).omit({ id: true });
export type InsertPersona = z.infer<typeof insertPersonaSchema>;
export type Persona = typeof personasTable.$inferSelect;
