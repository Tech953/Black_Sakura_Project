import { db } from "@workspace/db";
import { engramsTable } from "@workspace/db/schema";
import type { Engram, MediaAsset } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  claimNextPendingJob,
  loadMediaBlob,
  updateMediaAsset,
  appendMediaObservation,
  clearMediaObservations,
  recoverStuckJobs,
  upsertMediaContextMessage,
} from "../lib/media-store";
import { extractFromMedia, type MediaExtraction } from "../lib/media-extraction";
import { generateMediaCommentary } from "../lib/engram-generation";
import { summarizeWorldModel } from "../lib/world-model";
import { loadRecentWorldModel } from "../lib/world-model-store";
import { publishEvent } from "../lib/events";
import { loadOwnedConversation } from "../lib/account-bootstrap";

const WORKER_INTERVAL_MS = Number(process.env.MEDIA_WORKER_INTERVAL_MS) || 5_000;
/** A job stuck "processing" longer than this (e.g. a crash mid-job) is failed and unwedged. */
const STUCK_JOB_MS = 5 * 60_000;
/** Confidence assigned to OBSERVED-from-media world-model entries. */
const OBSERVATION_CONFIDENCE = 0.85;

let ticking = false; // re-entrancy guard: never run two ticks (or two jobs) at once
let started = false; // lifecycle guard so the worker only starts once
let timer: NodeJS.Timeout | null = null;

async function loadEngram(id: number, ownerId: string): Promise<Engram | undefined> {
  const [row] = await db.select().from(engramsTable).where(
    and(eq(engramsTable.id, id), eq(engramsTable.ownerId, ownerId)),
  );
  return row;
}

/**
 * Process one claimed media job end-to-end: extract observations via the modality
 * dispatcher, persist each as an OBSERVED world-model entry (source media:<id>, both
 * hardcoded in the store), store the summary/transcript, and generate the engram's
 * in-voice commentary. Throws on hard failure so the caller marks the job failed.
 */
async function processAsset(asset: MediaAsset): Promise<void> {
  // Recheck the durable ownership captured at enqueue time before touching bytes
  // or writing derived state. A global worker may claim any account's job, but
  // it must never process a template or a job whose parent changed ownership.
  const engram =
    asset.engramId == null
      ? undefined
      : await loadEngram(asset.engramId, asset.ownerId);
  if (asset.engramId != null && !engram) {
    throw new Error("Owning engram no longer belongs to this media job owner.");
  }
  if (asset.conversationId != null && !(await loadOwnedConversation(asset.conversationId, asset.ownerId))) {
    throw new Error("Owning conversation no longer belongs to this media job owner.");
  }
  const blob = await loadMediaBlob(asset.id);
  if (!blob) throw new Error("Media bytes are missing for this asset.");

  // Idempotency: re-processing (a retry) re-perceives the same bytes, so drop any
  // observations a prior partial run left behind before writing the fresh set.
  // This makes a retry REPLACE its earlier result rather than duplicate it.
  await clearMediaObservations(asset.id);

  const extraction = await extractFromMedia(
    { modality: asset.modality, mimeType: asset.mimeType, filename: asset.filename },
    blob.data,
  );

  // Perceive into the world model ONLY when an engram owns this asset. A default-PYRI
  // chat upload (engramId null) has no engram-scoped world model to write to — it still
  // extracts a summary/transcript and surfaces them as conversation context below, but
  // creates no observations and no in-voice commentary. Provenance/source stay hardcoded
  // inside appendMediaObservation; there is no path here to choose them.
  let written = 0;
  let commentary = "";
  if (asset.engramId != null) {
    for (const content of extraction.observations) {
      const trimmed = content.trim();
      if (!trimmed) continue;
      await appendMediaObservation({
        assetId: asset.id,
        engramId: asset.engramId,
        content: trimmed,
        confidence: OBSERVATION_CONFIDENCE,
      });
      written++;
    }

    // In-voice reaction. Best-effort: extraction already succeeded and observations are
    // persisted, so a commentary failure must not fail the whole job.
    if (engram) {
      try {
        const worldModelSummary = summarizeWorldModel(
          await loadRecentWorldModel(engram.id),
        );
        commentary = await generateMediaCommentary({
          engram,
          modality: asset.modality,
          filename: asset.filename,
          summary: extraction.summary,
          observations: extraction.observations,
          worldModelSummary,
        });
      } catch (err) {
        logger.error({ err, assetId: asset.id }, "media commentary generation failed");
      }
    }
  }

  await updateMediaAsset(asset.id, {
    status: "completed",
    summary: extraction.summary || null,
    transcript: extraction.transcript,
    commentary: commentary || null,
    observationCount: written,
    completedAt: new Date(),
    error: null,
  });

  publishEvent({
    type: "media.completed",
    ownerId: asset.ownerId,
    engramId: asset.engramId,
    conversationId: asset.conversationId,
    data: {
      id: asset.id,
      modality: asset.modality,
      filename: asset.filename,
      observationCount: written,
    },
  });

  // Surface the perception inside the chat thread it was dropped into (idempotent on
  // retry via the asset's contextMessageId). No-op when the asset isn't conversation-bound.
  if (asset.conversationId != null) {
    try {
      await upsertMediaContextMessage(asset, buildContextMessage(asset, extraction));
    } catch (err) {
      logger.error(
        { err, assetId: asset.id },
        "media context message upsert failed",
      );
    }
  }

  logger.info(
    {
      assetId: asset.id,
      engramId: asset.engramId,
      conversationId: asset.conversationId,
      modality: asset.modality,
      observations: written,
    },
    "media asset perceived",
  );
}

/**
 * Compose the `context` message body shown in a chat thread when an inline upload
 * finishes perceiving. Neutral, factual framing — it is conversation context, not an
 * instruction; the prompt layer frames it as such for the model.
 */
function buildContextMessage(asset: MediaAsset, extraction: MediaExtraction): string {
  const parts: string[] = [`[Perceived ${asset.modality}: ${asset.filename}]`];
  const summary = extraction.summary.trim();
  if (summary) parts.push(summary);
  const transcript = extraction.transcript?.trim();
  if (transcript) {
    parts.push(
      `Transcript: ${transcript.length > 600 ? `${transcript.slice(0, 600)}…` : transcript}`,
    );
  }
  return parts.join("\n");
}

/**
 * One worker tick: recover any stuck jobs, then claim and process at most ONE pending
 * job. The re-entrancy guard means a long extraction simply causes subsequent ticks
 * to no-op until it finishes, so only one job runs at a time.
 */
export async function runMediaTick(): Promise<{ processed: number }> {
  if (ticking) return { processed: 0 };
  ticking = true;
  try {
    const recovered = await recoverStuckJobs(STUCK_JOB_MS);
    if (recovered) logger.warn({ recovered }, "recovered stuck media jobs");

    const asset = await claimNextPendingJob();
    if (!asset) return { processed: 0 };

    try {
      await processAsset(asset);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, assetId: asset.id }, "media perception failed");
      await updateMediaAsset(asset.id, {
        status: "failed",
        error: message.slice(0, 500),
        completedAt: new Date(),
      });
    }
    return { processed: 1 };
  } finally {
    ticking = false;
  }
}

export function startMediaWorker(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    runMediaTick().catch((err) => logger.error({ err }, "media worker tick failed"));
  }, WORKER_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: WORKER_INTERVAL_MS }, "media worker started");
}

export function stopMediaWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
