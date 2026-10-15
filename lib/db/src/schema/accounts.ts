import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Application account identity. `id` is the immutable Clerk subject, never an
 * email or a client-provided profile field. The reserved system account holds
 * seed templates and is never returned by account-scoped queries.
 */
export const SYSTEM_OWNER_ID = "__engram_system_template__";

export const accountsTable = pgTable("accounts", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Account = typeof accountsTable.$inferSelect;