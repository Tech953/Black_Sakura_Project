import {
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { accountsTable } from "./accounts";

/** Expo push tokens currently registered for an authenticated mobile account. */
export const mobilePushTokensTable = pgTable(
  "mobile_push_tokens",
  {
    id: serial("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => accountsTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("mobile_push_tokens_token_unique").on(table.token)],
);

export type MobilePushToken = typeof mobilePushTokensTable.$inferSelect;