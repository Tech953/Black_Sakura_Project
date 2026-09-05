import { db } from "@workspace/db";
import {
  mediaAssetsTable,
  mediaBlobsTable,
  mediaObservationsTable,
  engramWorldModelTable,
  messages,
  type MediaAsset,
  type MediaModality,
  type MediaJobStatus,
  type EngramWorldModelEntry,
} from "@workspace/db/schema";
import { and, asc, desc, eq, lt, ne } from "drizzle-orm";
import { appendWorldModelEntry } from "./world-model-store";
import { SYSTEM_OWNER_ID } from "@workspace/db/schema";

export interface CreateMediaAssetInput {
  /** Account that owns this durable upload. */
  ownerId: string;
  /** Owning engram, or null for a default-PYRI-chat upload (no world-model writes). */
  engramId: number | null;
  /** The chat thread this upload was dropped into, if inline. */
  conversationId?: number | null;
  filename: string;
  mimeType: string;
  modality: MediaModality;
  data: Buffer;
}

/**
 * Persist a new upload: metadata row (status "pending") plus its raw bytes in the
 * 1:1 blob table, in a single transaction. Returns the metadata row only (no bytes).
 */
export async function createMediaAsset(
  input: CreateMediaAssetInput,
): Promise<MediaAsset> {
  return db.transaction(async (tx) => {
    const [asset] = await tx
      .insert(mediaAssetsTable)
      .values({
        engramId: input.engramId,
        ownerId: input.ownerId,
        conversationId: input.conversationId ?? null,
        filename: input.filename,
        mimeType: input.mimeType,
        modality: input.modality,
        sizeBytes: input.data.length,
        status: "pending",
      })
      .returning();
    await tx
      .insert(mediaBlobsTable)
      .values({ assetId: asset.id, data: input.data });
    return asset;
  });
}

/** Media assets bound to one conversation (inline chat uploads), newest first. */
export async function loadConversationMedia(
  conversationId: number,
): Promise<MediaAsset[]> {
  return db
    .select()
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.conversationId, conversationId))
    .orderBy(desc(mediaAssetsTable.createdAt));
}

/**
 * Insert (or, on retry, update) the single `context` message that surfaces a
 * completed inline upload inside its chat thread. Idempotent via the asset's
 * `contextMessageId`: the first completion inserts the message and stamps the id;
 * a re-perception updates that same message instead of duplicating it. No-op when
 * the asset is not bound to a conversation.
 */
export async function upsertMediaContextMessage(
  asset: MediaAsset,
  content: string,
): Promise<void> {
  const conversationId = asset.conversationId;
  if (conversationId == null) return;
  if (asset.contextMessageId != null) {
    await db
      .update(messages)
      .set({ content })
      .where(eq(messages.id, asset.contextMessageId));
    return;
  }
  // Insert-the-message and stamp-the-asset must be atomic: a crash between them
  // would leave the asset with no `contextMessageId`, so a retry would insert a
  // SECOND context message into the thread. The transaction makes the pair all-or-nothing.
  await db.transaction(async (tx) => {
    const [msg] = await tx
      .insert(messages)
      .values({ conversationId, role: "context", content })
      .returning();
    await tx
      .update(mediaAssetsTable)
      .set({ contextMessageId: msg.id, updatedAt: new Date() })
      .where(eq(mediaAssetsTable.id, asset.id));
  });
}

/** List media assets (metadata only — never the bytes), newest first. */
export async function loadMediaAssets(
  filter: { ownerId: string; engramId?: number; status?: MediaJobStatus },
): Promise<MediaAsset[]> {
  const conds = [eq(mediaAssetsTable.ownerId, filter.ownerId)];
  if (filter.engramId !== undefined)
    conds.push(eq(mediaAssetsTable.engramId, filter.engramId));
  if (filter.status !== undefined)
    conds.push(eq(mediaAssetsTable.status, filter.status));
  return db
    .select()
    .from(mediaAssetsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(mediaAssetsTable.createdAt));
}

export async function loadMediaAssetById(
  id: number,
  ownerId?: string,
): Promise<MediaAsset | undefined> {
  const [row] = await db
    .select()
    .from(mediaAssetsTable)
    .where(ownerId ? and(eq(mediaAssetsTable.id, id), eq(mediaAssetsTable.ownerId, ownerId)) : eq(mediaAssetsTable.id, id));
  return row;
}

/** Load the raw bytes + MIME for one asset (used only by the /raw streaming route). */
export async function loadMediaBlob(
  assetId: number,
  ownerId?: string,
): Promise<{ data: Buffer; mimeType: string } | undefined> {
  const [row] = await db
    .select({ data: mediaBlobsTable.data, mimeType: mediaAssetsTable.mimeType })
    .from(mediaBlobsTable)
    .innerJoin(mediaAssetsTable, eq(mediaAssetsTable.id, mediaBlobsTable.assetId))
    .where(ownerId ? and(eq(mediaBlobsTable.assetId, assetId), eq(mediaAssetsTable.ownerId, ownerId)) : eq(mediaBlobsTable.assetId, assetId));
  return row;
}

/**
 * Atomically claim the oldest pending job for processing. Uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers never grab the same row and a
 * locked row is skipped rather than blocking. Returns the claimed row, or
 * undefined when there is nothing pending.
 */
export async function claimNextPendingJob(): Promise<MediaAsset | undefined> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: mediaAssetsTable.id })
      .from(mediaAssetsTable)
      .where(and(eq(mediaAssetsTable.status, "pending"), ne(mediaAssetsTable.ownerId, SYSTEM_OWNER_ID)))
      .orderBy(asc(mediaAssetsTable.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!pending) return undefined;
    const now = new Date();
    const [claimed] = await tx
      .update(mediaAssetsTable)
      .set({ status: "processing", startedAt: now, error: null, updatedAt: now })
      .where(eq(mediaAssetsTable.id, pending.id))
      .returning();
    return claimed;
  });
}

/**
 * Recover jobs stuck in "processing" longer than `olderThanMs` (e.g. a crash mid-job)
 * by failing them so they don't wedge the queue forever. Returns the count recovered.
 */
export async function recoverStuckJobs(olderThanMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await db
    .update(mediaAssetsTable)
    .set({
      status: "failed",
      error: "Processing timed out and was recovered.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(mediaAssetsTable.status, "processing"),
        ne(mediaAssetsTable.ownerId, SYSTEM_OWNER_ID),
        lt(mediaAssetsTable.startedAt, cutoff),
      ),
    )
    .returning({ id: mediaAssetsTable.id });
  return rows.length;
}

export type MediaAssetPatch = Partial<
  Pick<
    MediaAsset,
    | "status"
    | "summary"
    | "commentary"
    | "transcript"
    | "error"
    | "observationCount"
    | "startedAt"
    | "completedAt"
  >
>;

export async function updateMediaAsset(
  id: number,
  patch: MediaAssetPatch,
): Promise<MediaAsset | undefined> {
  const [row] = await db
    .update(mediaAssetsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(mediaAssetsTable.id, id))
    .returning();
  return row;
}

/**
 * Re-queue a FAILED asset for another perception pass. The `status = 'failed'`
 * guard is part of the UPDATE itself (not a separate read) so two concurrent
 * retries can't both requeue — the loser updates zero rows and gets `undefined`.
 */
export async function requeueMediaAsset(
  id: number,
): Promise<MediaAsset | undefined> {
  const now = new Date();
  const [row] = await db
    .update(mediaAssetsTable)
    .set({
      status: "pending",
      error: null,
      summary: null,
      commentary: null,
      transcript: null,
      observationCount: 0,
      startedAt: null,
      completedAt: null,
      updatedAt: now,
    })
    .where(and(eq(mediaAssetsTable.id, id), eq(mediaAssetsTable.status, "failed")))
    .returning();
  return row;
}

/**
 * Drop every world-model entry (and its mapping row) a prior run of this asset
 * produced. Called at the start of (re)processing so a retry REPLACES its earlier,
 * possibly partial, result instead of appending duplicate observations. The
 * world-model rows are matched by their hardcoded `source = "media:<id>"` tag; the
 * mapping rows are cleared explicitly so the operation is order-independent.
 */
export async function clearMediaObservations(assetId: number): Promise<void> {
  await db
    .delete(mediaObservationsTable)
    .where(eq(mediaObservationsTable.assetId, assetId));
  await db
    .delete(engramWorldModelTable)
    .where(eq(engramWorldModelTable.source, `media:${assetId}`));
}

/**
 * Append ONE perceived observation to the engram's world model and link it to the
 * source asset.
 *
 * Provenance is HARDCODED to "observed" and source to `media:<assetId>` here — never
 * taken from model output — so anything an engram perceives in shared media can only
 * ever enter its world model as a genuine, traceable observation. This mirrors
 * `appendSimulationStep`'s hardcoded "simulated" provenance guarantee, in the
 * opposite direction: there is no code path that lets perception masquerade as
 * anything other than OBSERVED, nor any way for the model to choose its own
 * provenance/source.
 */
export async function appendMediaObservation(input: {
  assetId: number;
  engramId: number;
  content: string;
  confidence: number;
}): Promise<EngramWorldModelEntry> {
  const entry = await appendWorldModelEntry({
    engramId: input.engramId,
    provenance: "observed",
    content: input.content,
    confidence: input.confidence,
    scope: "private",
    source: `media:${input.assetId}`,
  });
  await db
    .insert(mediaObservationsTable)
    .values({ assetId: input.assetId, worldModelEntryId: entry.id });
  return entry;
}

/** Load the world-model entries an asset produced (via the mapping table), newest first. */
export async function loadMediaObservations(
  assetId: number,
): Promise<EngramWorldModelEntry[]> {
  const rows = await db
    .select({ entry: engramWorldModelTable })
    .from(mediaObservationsTable)
    .innerJoin(
      engramWorldModelTable,
      eq(engramWorldModelTable.id, mediaObservationsTable.worldModelEntryId),
    )
    .where(eq(mediaObservationsTable.assetId, assetId))
    .orderBy(desc(engramWorldModelTable.createdAt));
  return rows.map((r) => r.entry);
}

/**
 * Delete an asset and its bytes. Cascade also removes the observation MAPPING rows,
 * but the world-model entries themselves are PRESERVED — they are genuine
 * observations the engram made and must outlive the source file.
 */
export async function deleteMediaAsset(id: number): Promise<boolean> {
  const rows = await db
    .delete(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, id))
    .returning({ id: mediaAssetsTable.id });
  return rows.length > 0;
}
