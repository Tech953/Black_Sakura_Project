import { pgTable, serial, text, real, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const evolutionTable = pgTable("evolution", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  revision: integer("revision").notNull(),
  trigger: text("trigger").notNull(),
  description: text("description").notNull(),
  evidenceConsidered: text("evidence_considered"),
  confidence: real("confidence").notNull(),
  expectedImpact: text("expected_impact"),
  validationOutcome: text("validation_outcome"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evolution_owner_idx").on(t.ownerId)]);

export const insertEvolutionSchema = createInsertSchema(evolutionTable).omit({ id: true, createdAt: true });
export type InsertEvolution = z.infer<typeof insertEvolutionSchema>;
export type Evolution = typeof evolutionTable.$inferSelect;
