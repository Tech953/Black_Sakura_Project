import { pgTable, serial, text, timestamp, integer, index, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  title: text("title").notNull(),
  mode: text("mode").notNull().default("companion"),
  personaName: text("persona_name"),
  customEngram: text("custom_engram"),
  engramId: integer("engram_id").references(() => engramsTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [
  index("conversations_owner_idx").on(table.ownerId),
  index("conversations_owner_archived_idx").on(table.ownerId, table.archivedAt),
]);

/** Explicit, user-selected participants for human-mediated group conversations. */
export const conversationEngramParticipants = pgTable(
  "conversation_engram_participants",
  {
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    engramId: integer("engram_id")
      .notNull()
      .references(() => engramsTable.id, { onDelete: "cascade" }),
    ownerId: text("owner_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.conversationId, table.engramId] }),
    index("conversation_engram_participants_owner_idx").on(table.ownerId),
    index("conversation_engram_participants_engram_idx").on(table.engramId),
  ],
);

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
