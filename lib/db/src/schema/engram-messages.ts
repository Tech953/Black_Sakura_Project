import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";
import { hubSpacesTable } from "./hub-spaces";

/**
 * The channel a bus message travels on. "engram" = engram-to-engram (spoken in a
 * shared space); "human" = engram-initiated contact directed at the operator.
 */
export const ENGRAM_MESSAGE_CHANNELS = ["engram", "human"] as const;
export type EngramMessageChannel = (typeof ENGRAM_MESSAGE_CHANNELS)[number];

/**
 * Priority class for engram-initiated human contact. Drives delivery handling:
 * urgent = delivered immediately, meaningful = queued, social = batched into a digest.
 */
export const ENGRAM_MESSAGE_PRIORITIES = ["urgent", "meaningful", "social"] as const;
export type EngramMessagePriority = (typeof ENGRAM_MESSAGE_PRIORITIES)[number];

/**
 * Delivery/audit status of a bus message. "blocked" carries a `reason` explaining
 * why an attempt was refused (rate limit, quiet mode, disabled contact, coercion, …).
 */
export const ENGRAM_MESSAGE_STATUSES = ["delivered", "queued", "digest", "blocked"] as const;
export type EngramMessageStatus = (typeof ENGRAM_MESSAGE_STATUSES)[number];

/**
 * The message bus: the single auditable record of every engram-to-engram exchange
 * and every engram-initiated contact attempt to the operator. Every attempt is
 * written here — including refusals (status "blocked") — so the log is complete.
 */
export const engramMessagesTable = pgTable(
  "engram_messages",
  {
    id: serial("id").primaryKey(),
    fromEngramId: integer("from_engram_id")
      .notNull()
      .references(() => engramsTable.id, { onDelete: "cascade" }),
    /** Recipient engram, or NULL when the message is addressed to the human operator. */
    toEngramId: integer("to_engram_id").references(() => engramsTable.id, {
      onDelete: "cascade",
    }),
    /** Space the message was spoken in (engram channel). NULL for human-channel contact. */
    spaceId: integer("space_id").references(() => hubSpacesTable.id, {
      onDelete: "set null",
    }),
    /** One of ENGRAM_MESSAGE_CHANNELS. */
    channel: text("channel").notNull(),
    /** One of ENGRAM_MESSAGE_PRIORITIES (meaningful default for engram channel). */
    priority: text("priority").notNull(),
    /** One of ENGRAM_MESSAGE_STATUSES. */
    status: text("status").notNull(),
    content: text("content").notNull(),
    /** Audit note: why a message was blocked, queued, or digested. */
    reason: text("reason"),
    seen: boolean("seen").notNull().default(false),
    /** True for the single operator-facing summary created from digest messages. */
    isDigest: boolean("is_digest").notNull().default(false),
    /** Set when this digest-status source message has been included in a summary. */
    digestedAt: timestamp("digested_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("engram_messages_channel_created_idx").on(t.channel, t.createdAt),
    index("engram_messages_from_created_idx").on(t.fromEngramId, t.createdAt),
    index("engram_messages_to_created_idx").on(t.toEngramId, t.createdAt),
    index("engram_messages_space_created_idx").on(t.spaceId, t.createdAt),
  ],
);

export const insertEngramMessageSchema = createInsertSchema(engramMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertEngramMessage = z.infer<typeof insertEngramMessageSchema>;
export type EngramMessage = typeof engramMessagesTable.$inferSelect;
export type NewEngramMessage = typeof engramMessagesTable.$inferInsert;
