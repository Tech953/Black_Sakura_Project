import { db } from "@workspace/db";
import {
  conversations,
  engramsTable,
  engramArtifactsTable,
  engramArtifactBlobsTable,
  type EngramArtifact,
  type ArtifactKind,
  type ArtifactTrigger,
  type ArtifactJobStatus,
} from "@workspace/db/schema";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  ne,
  notExists,
} from "drizzle-orm";
import { publishEvent } from "./events";
import {
  ARCHIVAL_READ_ONLY_ERROR,
  artifactTouchesArchive,
} from "./archival";
import { SYSTEM_OWNER_ID } from "@workspace/db/schema";

export interface CreateArtifactInput {
  ownerId: string;
  engramId: number;
  conversationId?: number | null;
  trigger: ArtifactTrigger;
  kind: ArtifactKind;
  title: string;
  prompt: string;
}

/**
 * Queue a new generation job: a metadata row with status "pending". The bytes are
 * written later by the worker on completion (in `completeArtifact`), so there is no
 * blob row until then. Returns the metadata row.
 */
export async function createArtifactJob(
  input: CreateArtifactInput,
): Promise<EngramArtifact> {
  if (
    await artifactTouchesArchive({
      engramId: input.engramId,
      conversationId: input.conversationId ?? null,
    })
  ) {
    throw new Error(ARCHIVAL_READ_ONLY_ERROR);
  }
  const [row] = await db
    .insert(engramArtifactsTable)
    .values({
      ownerId: input.ownerId,
      engramId: input.engramId,
      conversationId: input.conversationId ?? null,
      trigger: input.trigger,
      kind: input.kind,
      title: input.title,
      prompt: input.prompt,
      status: "pending",
    })
    .returning();
  publishEvent({
    type: "artifact.created",
    ownerId: row.ownerId,
    engramId: row.engramId,
    conversationId: row.conversationId,
    data: row,
  });
  return row;
}

/** List generated artifacts (metadata only — never the bytes), newest first. */
export async function loadArtifacts(
  filter: {
    ownerId: string;
    engramId?: number;
    status?: ArtifactJobStatus;
    kind?: ArtifactKind;
  },
): Promise<EngramArtifact[]> {
  const conds = [eq(engramArtifactsTable.ownerId, filter.ownerId)];
  if (filter.engramId !== undefined)
    conds.push(eq(engramArtifactsTable.engramId, filter.engramId));
  if (filter.status !== undefined)
    conds.push(eq(engramArtifactsTable.status, filter.status));
  if (filter.kind !== undefined)
    conds.push(eq(engramArtifactsTable.kind, filter.kind));
  return db
    .select()
    .from(engramArtifactsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(engramArtifactsTable.createdAt));
}

export async function loadArtifactById(
  id: number,
  ownerId?: string,
): Promise<EngramArtifact | undefined> {
  const [row] = await db
    .select()
    .from(engramArtifactsTable)
    .where(ownerId ? and(eq(engramArtifactsTable.id, id), eq(engramArtifactsTable.ownerId, ownerId)) : eq(engramArtifactsTable.id, id));
  return row;
}

/** Load the raw bytes + MIME/filename for one artifact (used only by the /raw route). */
export async function loadArtifactBlob(
  artifactId: number,
  ownerId?: string,
): Promise<{ data: Buffer; mimeType: string; filename: string } | undefined> {
  const [row] = await db
    .select({
      data: engramArtifactBlobsTable.data,
      mimeType: engramArtifactsTable.mimeType,
      filename: engramArtifactsTable.filename,
    })
    .from(engramArtifactBlobsTable)
    .innerJoin(
      engramArtifactsTable,
      eq(engramArtifactsTable.id, engramArtifactBlobsTable.artifactId),
    )
    .where(ownerId ? and(eq(engramArtifactBlobsTable.artifactId, artifactId), eq(engramArtifactsTable.ownerId, ownerId)) : eq(engramArtifactBlobsTable.artifactId, artifactId));
  if (!row) return undefined;
  // node-postgres returns bytea as a Buffer; PGlite (desktop) returns a Uint8Array.
  // Normalize to Buffer so the /raw route's res.send + Content-Length behave the
  // same on both drivers.
  const data = Buffer.isBuffer(row.data)
    ? row.data
    : Buffer.from(row.data as Uint8Array);
  return {
    data,
    mimeType: row.mimeType ?? "application/octet-stream",
    filename: row.filename ?? `artifact-${artifactId}`,
  };
}

/**
 * Atomically claim the oldest pending job for processing. Uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers never grab the same row and a
 * locked row is skipped rather than blocking. Returns the claimed row, or
 * undefined when there is nothing pending.
 */
export async function claimNextPendingArtifact(): Promise<
  EngramArtifact | undefined
> {
  const claimed = await db.transaction(async (tx) => {
    const directArchivalOwner = tx
      .select({ id: engramsTable.id })
      .from(engramsTable)
      .where(
        and(
          eq(engramsTable.id, engramArtifactsTable.engramId),
          eq(engramsTable.isArchival, true),
        ),
      );
    const archivalConversationOwner = tx
      .select({ id: conversations.id })
      .from(conversations)
      .innerJoin(engramsTable, eq(engramsTable.id, conversations.engramId))
      .where(
        and(
          eq(conversations.id, engramArtifactsTable.conversationId),
          eq(engramsTable.isArchival, true),
        ),
      );
    const [pending] = await tx
      .select({ id: engramArtifactsTable.id })
      .from(engramArtifactsTable)
      .where(
        and(
          eq(engramArtifactsTable.status, "pending"),
          ne(engramArtifactsTable.ownerId, SYSTEM_OWNER_ID),
          notExists(directArchivalOwner),
          notExists(archivalConversationOwner),
        ),
      )
      .orderBy(asc(engramArtifactsTable.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!pending) return undefined;
    const now = new Date();
    const [row] = await tx
      .update(engramArtifactsTable)
      .set({ status: "processing", startedAt: now, error: null, updatedAt: now })
      .where(eq(engramArtifactsTable.id, pending.id))
      .returning();
    return row;
  });
  if (claimed) {
    publishEvent({
      type: "artifact.updated",
      ownerId: claimed.ownerId,
      engramId: claimed.engramId,
      conversationId: claimed.conversationId,
      data: claimed,
    });
  }
  return claimed;
}

/**
 * Recover jobs stuck in "processing" longer than `olderThanMs` (e.g. a crash mid-job)
 * by failing them so they don't wedge the queue forever. Returns the count recovered.
 */
export async function recoverStuckArtifacts(
  olderThanMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const directArchivalOwner = db
    .select({ id: engramsTable.id })
    .from(engramsTable)
    .where(
      and(
        eq(engramsTable.id, engramArtifactsTable.engramId),
        eq(engramsTable.isArchival, true),
      ),
    );
  const archivalConversationOwner = db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(engramsTable, eq(engramsTable.id, conversations.engramId))
    .where(
      and(
        eq(conversations.id, engramArtifactsTable.conversationId),
        eq(engramsTable.isArchival, true),
      ),
    );
  const rows = await db
    .update(engramArtifactsTable)
    .set({
      status: "failed",
      error: "Generation timed out and was recovered.",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(engramArtifactsTable.status, "processing"),
          ne(engramArtifactsTable.ownerId, SYSTEM_OWNER_ID),
        lt(engramArtifactsTable.startedAt, cutoff),
        notExists(directArchivalOwner),
        notExists(archivalConversationOwner),
      ),
    )
    .returning({ id: engramArtifactsTable.id });
  return rows.length;
}

export type ArtifactPatch = Partial<
  Pick<
    EngramArtifact,
    | "status"
    | "provider"
    | "mimeType"
    | "filename"
    | "sizeBytes"
    | "summary"
    | "error"
    | "startedAt"
    | "completedAt"
  >
>;

export async function updateArtifact(
  id: number,
  patch: ArtifactPatch,
): Promise<EngramArtifact | undefined> {
  const existing = await loadArtifactById(id);
  if (existing && (await artifactTouchesArchive(existing))) return undefined;
  const [row] = await db
    .update(engramArtifactsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(engramArtifactsTable.id, id))
    .returning();
  return row;
}

/**
 * Persist generated bytes and mark the job completed, atomically. Any prior blob
 * (e.g. from an earlier run before a retry) is replaced so completion is
 * idempotent — re-completing never leaves two blob rows.
 */
export async function completeArtifact(input: {
  id: number;
  data: Buffer;
  mimeType: string;
  filename: string;
  provider: string;
  summary: string | null;
}): Promise<EngramArtifact | undefined> {
  const existing = await loadArtifactById(input.id);
  if (existing && (await artifactTouchesArchive(existing))) return undefined;
  const completed = await db.transaction(async (tx) => {
    await tx
      .delete(engramArtifactBlobsTable)
      .where(eq(engramArtifactBlobsTable.artifactId, input.id));
    await tx
      .insert(engramArtifactBlobsTable)
      .values({ artifactId: input.id, data: input.data });
    const now = new Date();
    const [row] = await tx
      .update(engramArtifactsTable)
      .set({
        status: "completed",
        provider: input.provider,
        mimeType: input.mimeType,
        filename: input.filename,
        sizeBytes: input.data.length,
        summary: input.summary,
        error: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(engramArtifactsTable.id, input.id))
      .returning();
    return row;
  });
  if (completed) {
    publishEvent({
      type: "artifact.completed",
      ownerId: completed.ownerId,
      engramId: completed.engramId,
      conversationId: completed.conversationId,
      data: completed,
    });
  }
  return completed;
}

/**
 * Re-queue a FAILED artifact for another generation pass. The `status = 'failed'`
 * guard is part of the UPDATE itself (not a separate read) so two concurrent
 * retries can't both requeue — the loser updates zero rows and gets `undefined`.
 * Any leftover blob is dropped so the regenerated bytes fully replace the old ones.
 */
export async function requeueArtifact(
  id: number,
): Promise<EngramArtifact | undefined> {
  const existing = await loadArtifactById(id);
  if (existing && (await artifactTouchesArchive(existing))) return undefined;
  return db.transaction(async (tx) => {
    const now = new Date();
    const [row] = await tx
      .update(engramArtifactsTable)
      .set({
        status: "pending",
        provider: null,
        mimeType: null,
        filename: null,
        sizeBytes: 0,
        summary: null,
        error: null,
        startedAt: null,
        completedAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(engramArtifactsTable.id, id),
          eq(engramArtifactsTable.status, "failed"),
        ),
      )
      .returning();
    if (!row) return undefined;
    await tx
      .delete(engramArtifactBlobsTable)
      .where(eq(engramArtifactBlobsTable.artifactId, id));
    return row;
  });
}

/** Delete an artifact and its bytes (cascade removes the blob row). */
export async function deleteArtifact(id: number): Promise<boolean> {
  const existing = await loadArtifactById(id);
  if (existing && (await artifactTouchesArchive(existing))) return false;
  const rows = await db
    .delete(engramArtifactsTable)
    .where(eq(engramArtifactsTable.id, id))
    .returning({ id: engramArtifactsTable.id });
  return rows.length > 0;
}

/**
 * Count an engram's generation jobs created since a cutoff — the basis for the
 * autonomous daily cap. Counts ALL created rows (including failed/canceled) so the
 * cap is conservative: a failed cloud attempt may still have incurred cost, so it
 * still counts against the day. Optionally filtered by trigger.
 */
export async function countArtifactsSince(
  engramId: number,
  since: Date,
  trigger?: ArtifactTrigger,
): Promise<number> {
  const conds = [
    eq(engramArtifactsTable.engramId, engramId),
    gte(engramArtifactsTable.createdAt, since),
  ];
  if (trigger) conds.push(eq(engramArtifactsTable.trigger, trigger));
  const rows = await db
    .select({ id: engramArtifactsTable.id })
    .from(engramArtifactsTable)
    .where(and(...conds));
  return rows.length;
}

/**
 * Most-recent AUTONOMOUS artifact timestamp per engram. The engine uses this for
 * the per-engram generation cooldown and for fair (least-recently-generated)
 * scheduling. Engrams that have never autonomously generated are simply absent
 * from the returned map.
 */
export async function loadLastAutonomousArtifactAt(
  engramIds: number[],
): Promise<Map<number, Date>> {
  if (engramIds.length === 0) return new Map();
  const rows = await db
    .select({
      engramId: engramArtifactsTable.engramId,
      createdAt: engramArtifactsTable.createdAt,
    })
    .from(engramArtifactsTable)
    .where(
      and(
        inArray(engramArtifactsTable.engramId, engramIds),
        eq(engramArtifactsTable.trigger, "autonomous"),
      ),
    )
    .orderBy(desc(engramArtifactsTable.createdAt));
  const map = new Map<number, Date>();
  for (const r of rows) {
    if (!map.has(r.engramId)) map.set(r.engramId, r.createdAt);
  }
  return map;
}
