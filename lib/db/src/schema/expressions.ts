import { pgTable, serial, text, integer, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import {
  NEUTRAL_EXPRESSION_ROLE_VALUES,
  SEED_EXPRESSION_ROLE_VALUES,
} from "@workspace/expression-role-policy";

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

const expressionInsertBaseSchema = createInsertSchema(expressionsTable).omit({
  id: true,
});
const expressionRoleError =
  "Cognitive role must be an approved neutral expression role or null.";

export const insertExpressionSchema = expressionInsertBaseSchema.extend({
  cognitiveRole: z
    .enum(NEUTRAL_EXPRESSION_ROLE_VALUES, { error: expressionRoleError })
    .nullable()
    .optional(),
});
export const updateExpressionSchema = insertExpressionSchema.partial();

// Seeds may preserve the explicitly stored-only `attachment` classification.
// This exception is derived from the same shared role policy, not a second list.
export const seedExpressionSchema = expressionInsertBaseSchema.extend({
  cognitiveRole: z
    .enum(SEED_EXPRESSION_ROLE_VALUES, {
      error: "Cognitive role must be approved for expression seed data or null.",
    })
    .nullable()
    .optional(),
});

export type InsertExpression = z.infer<typeof insertExpressionSchema>;
export type UpdateExpression = z.infer<typeof updateExpressionSchema>;
export type SeedExpression = z.infer<typeof seedExpressionSchema>;
export type Expression = typeof expressionsTable.$inferSelect;
