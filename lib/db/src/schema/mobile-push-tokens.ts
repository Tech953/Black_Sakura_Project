import {
  check,
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { accountsTable } from "./accounts";
import { engramTransmissionsTable } from "./engram-transmissions";

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

/**
 * Provider ticket outcomes for an outreach dispatch. This deliberately does
 * not retain the Expo token: the token table is the only token-bearing table,
 * and invalid tokens are removed as soon as Expo reports them.
 */
export const mobilePushDeliveryResultsTable = pgTable(
  "mobile_push_delivery_results",
  {
    id: serial("id").primaryKey(),
    transmissionId: integer("transmission_id")
      .notNull()
      .references(() => engramTransmissionsTable.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    status: text("status").notNull(),
    errorCategory: text("error_category"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mobile_push_delivery_results_transmission_created_idx").on(
      table.transmissionId,
      table.createdAt,
    ),
    check(
      "mobile_push_delivery_results_status_check",
      sql`${table.status} in ('ok', 'error')`,
    ),
    check(
      "mobile_push_delivery_results_error_category_check",
      sql`${table.errorCategory} is null or ${table.errorCategory} in ('device-not-registered', 'message-too-big', 'rate-limited', 'invalid-credentials', 'provider-error', 'provider-http-error', 'provider-unavailable', 'unknown')`,
    ),
  ],
);

export type MobilePushDeliveryResult =
  typeof mobilePushDeliveryResultsTable.$inferSelect;