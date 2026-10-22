import { db } from "@workspace/db";
import { engramsTable } from "@workspace/db/schema";
import type { Engram, EngramArtifact } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  claimNextPendingArtifact,
  recoverStuckArtifacts,
  updateArtifact,
  completeArtifact,
} from "../lib/artifact-store";
import { generateArtifact } from "../lib/artifact-generation";
import { publishEvent } from "../lib/events";
import type { ArtifactKind } from "@workspace/db/schema";
import { summarizeWorldModel } from "../lib/world-model";
import { loadRecentWorldModel } from "../lib/world-model-store";
import { loadOwnedConversation } from "../lib/account-bootstrap";

/**
 * Async generation ticker — the OUTPUT mirror of `media-worker.ts`. Same lifecycle
 * shape: a reentrancy guard, one claim/tick via `FOR UPDATE SKIP LOCKED`, and
 * stuck-job recovery. A failed generation marks the job "failed" (with the reason)
 * rather than crashing the loop.
 */
const WORKER_INTERVAL_MS =
  Number(process.env["ARTIFACT_WORKER_INTERVAL_MS"]) || 5_000;
const STUCK_JOB_MS = 5 * 60_000;

let ticking = false;
let started = false;
let timer: NodeJS.Timeout | null = null;

async function loadEngram(id: number, ownerId: string): Promise<Engram | undefined> {
  const [row] = await db
    .select()
    .from(engramsTable)
    .where(and(eq(engramsTable.id, id), eq(engramsTable.ownerId, ownerId)));
  return row;
}

async function processArtifact(artifact: EngramArtifact): Promise<void> {
  const engram = await loadEngram(artifact.engramId, artifact.ownerId);
  if (!engram) throw new Error("Owning engram no longer exists.");
  if (
    artifact.conversationId != null &&
    !(await loadOwnedConversation(artifact.conversationId, artifact.ownerId))
  ) {
    throw new Error("Owning conversation no longer belongs to this artifact job owner.");
  }

  let worldModelSummary: string | undefined;
  try {
    worldModelSummary = summarizeWorldModel(
      await loadRecentWorldModel(engram.id),
    );
  } catch (err) {
    logger.error(
      { err, artifactId: artifact.id },
      "world-model load for artifact failed; continuing without it",
    );
  }

  const result = await generateArtifact({
    engram,
    kind: artifact.kind as ArtifactKind,
    title: artifact.title,
    prompt: artifact.prompt,
    worldModelSummary,
  });

  await completeArtifact({
    id: artifact.id,
    data: result.data,
    mimeType: result.mimeType,
    filename: result.filename,
    provider: result.provider,
    summary: result.summary,
  });

  logger.info(
    {
      artifactId: artifact.id,
      engramId: artifact.engramId,
      kind: artifact.kind,
      bytes: result.data.length,
      provider: result.provider,
    },
    "engram artifact generated",
  );
}

/** Run a single tick: recover stuck jobs, then claim and process at most one job. */
export async function runArtifactTick(): Promise<{ processed: number }> {
  if (ticking) return { processed: 0 };
  ticking = true;
  try {
    const recovered = await recoverStuckArtifacts(STUCK_JOB_MS);
    if (recovered) logger.warn({ recovered }, "recovered stuck artifact jobs");

    const artifact = await claimNextPendingArtifact();
    if (!artifact) return { processed: 0 };

    try {
      await processArtifact(artifact);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, artifactId: artifact.id }, "artifact generation failed");
      const failed = await updateArtifact(artifact.id, {
        status: "failed",
        error: message.slice(0, 500),
        completedAt: new Date(),
      });
      if (failed) {
        publishEvent({
          type: "artifact.failed",
          ownerId: failed.ownerId,
          engramId: failed.engramId,
          conversationId: failed.conversationId,
          data: failed,
        });
      }
    }
    return { processed: 1 };
  } finally {
    ticking = false;
  }
}

export function startArtifactWorker(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    runArtifactTick().catch((err) =>
      logger.error({ err }, "artifact worker tick failed"),
    );
  }, WORKER_INTERVAL_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: WORKER_INTERVAL_MS }, "artifact worker started");
}

export function stopArtifactWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
