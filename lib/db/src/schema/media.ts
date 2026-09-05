import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";
import { engramWorldModelTable } from "./engram-world-model";
import { conversations } from "./conversations";
import { messages } from "./messages";
import { SYSTEM_OWNER_ID } from "./accounts";

/**
 * Perceptual modality of an uploaded media asset. Detected from MIME type on
 * upload and never taken from model output.
 */
export const MEDIA_MODALITIES = ["text", "image", "audio", "video"] as const;
export type MediaModality = (typeof MEDIA_MODALITIES)[number];

/**
 * Lifecycle of an asynchronous media-perception job:
 * - pending: uploaded, awaiting the worker.
 * - processing: the worker has claimed it and is extracting observations.
 * - completed: extraction finished; observations + summary + commentary written.
 * - failed: extraction errored (or timed out); `error` carries the reason.
 *
 * Status is set only by server-side logic (upload route + worker), never by model
 * output. Unknown values are treated as inert.
 */
export const MEDIA_JOB_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;
export type MediaJobStatus = (typeof MEDIA_JOB_STATUSES)[number];

/** Postgres `bytea` column holding raw uploaded bytes as a Node Buffer. */
const bytea = customType<{ data: Buffer; default: false }>({
  dataType() {
    return "bytea";
  },
});

/**
 * An uploaded media asset, plus its perception-job lifecycle and results. The raw
 * bytes live in `media_blobs` (1:1) so list/status queries never drag megabytes into
 * memory — this table carries metadata + results only.
 *
 * `engramId` is NULLABLE: an upload tied to an engram (Media page, or an engram-linked
 * chat) perceives into that engram's world model; an upload made inside the default
 * PYRI chat has no owning engram, so it extracts a summary/transcript but writes NO
 * world-model rows (the world model stays strictly engram-scoped). `conversationId`
 * binds an inline chat upload to the thread it was dropped into, and `contextMessageId`
 * is the idempotency anchor for the single `context` message the worker inserts on
 * completion (so a retry updates that message rather than duplicating it).
 */
export const mediaAssetsTable = pgTable(
  "media_assets",
  {
    id: serial("id").primaryKey(),
    /** Account that owns this durable upload, including default-PYRI uploads. */
    ownerId: text("owner_id").notNull().default(SYSTEM_OWNER_ID),
    engramId: integer("engram_id").references(() => engramsTable.id, {
      onDelete: "cascade",
    }),
    /** The chat thread an inline upload was dropped into, if any. */
    conversationId: integer("conversation_id").references(
      () => conversations.id,
      { onDelete: "cascade" },
    ),
    /** The single `context` message the worker inserted for this asset, if any. */
    contextMessageId: integer("context_message_id").references(
      () => messages.id,
      { onDelete: "set null" },
    ),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    /** One of MEDIA_MODALITIES — derived from MIME on upload. */
    modality: text("modality").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** One of MEDIA_JOB_STATUSES — set only by upload route + worker. */
    status: text("status").notNull().default("pending"),
    /** Neutral 1–3 sentence summary of what was perceived (worker output). */
    summary: text("summary"),
    /** The engram's in-voice reaction to the media (worker output). */
    commentary: text("commentary"),
    /** Transcript for audio/video, if any. */
    transcript: text("transcript"),
    /** Failure reason when status is "failed" — surfaced to the operator. */
    error: text("error"),
    /** How many OBSERVED world-model entries this asset produced. */
    observationCount: integer("observation_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_assets_engram_idx").on(t.engramId),
    index("media_assets_owner_idx").on(t.ownerId),
    index("media_assets_status_idx").on(t.status),
    index("media_assets_conversation_idx").on(t.conversationId),
  ],
);

/**
 * Raw bytes of an uploaded asset, kept in a separate 1:1 table so the metadata
 * table can be listed/polled without ever loading file contents.
 */
export const mediaBlobsTable = pgTable("media_blobs", {
  assetId: integer("asset_id")
    .primaryKey()
    .references(() => mediaAssetsTable.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

/**
 * Maps a media asset to each OBSERVED world-model entry it produced. Gives
 * structural traceability for detail views and deletion policy beyond the
 * `source = "media:<id>"` tag on the entry itself. Deleting the asset removes
 * the mapping rows (cascade) but PRESERVES the world-model entries — they are
 * genuine observations the engram made.
 */
export const mediaObservationsTable = pgTable(
  "media_observations",
  {
    id: serial("id").primaryKey(),
    assetId: integer("asset_id")
      .notNull()
      .references(() => mediaAssetsTable.id, { onDelete: "cascade" }),
    worldModelEntryId: integer("world_model_entry_id")
      .notNull()
      .references(() => engramWorldModelTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_observations_asset_idx").on(t.assetId)],
);

export const insertMediaAssetSchema = createInsertSchema(mediaAssetsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertMediaAsset = z.infer<typeof insertMediaAssetSchema>;
export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
export type NewMediaAsset = typeof mediaAssetsTable.$inferInsert;
export type MediaObservationLink = typeof mediaObservationsTable.$inferSelect;
