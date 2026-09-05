import { Router } from "express";
import { db } from "@workspace/db";
import { conversations, engramsTable } from "@workspace/db/schema";
import type { EngramArtifact, ArtifactKind } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  ListArtifactsQueryParams,
  CreateArtifactBody,
  GetArtifactParams,
  RetryArtifactParams,
  DeleteArtifactParams,
} from "@workspace/api-zod";
import {
  createArtifactJob,
  loadArtifacts,
  loadArtifactById,
  loadArtifactBlob,
  requeueArtifact,
  deleteArtifact,
} from "../lib/artifact-store";
import type { ArtifactJobStatus } from "@workspace/db";
import {
  ARCHIVAL_READ_ONLY_ERROR,
  artifactTouchesArchive,
  isArchivalEngram,
} from "../lib/archival";

const router = Router();

function serializeArtifact(a: EngramArtifact) {
  return {
    id: a.id,
    engramId: a.engramId,
    conversationId: a.conversationId,
    trigger: a.trigger,
    kind: a.kind,
    title: a.title,
    prompt: a.prompt,
    provider: a.provider ?? null,
    mimeType: a.mimeType ?? null,
    filename: a.filename ?? null,
    sizeBytes: a.sizeBytes,
    status: a.status,
    summary: a.summary ?? null,
    error: a.error ?? null,
    startedAt: a.startedAt ? a.startedAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

router.get("/artifacts", async (req, res) => {
  const parsed = ListArtifactsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadArtifacts({
    engramId: parsed.data.engramId,
    status: parsed.data.status as ArtifactJobStatus | undefined,
    kind: parsed.data.kind as ArtifactKind | undefined,
  });
  res.json(rows.map(serializeArtifact));
});

/**
 * Operator "create now": queue a generation job. The trigger is hardcoded
 * "operator" here — the model never chooses it. The worker picks up the pending
 * row and produces the bytes.
 */
router.post("/artifacts", async (req, res) => {
  const parsed = CreateArtifactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { engramId, kind, title, prompt, conversationId } = parsed.data;
  try {
    const [engram] = await db
      .select({ id: engramsTable.id, isArchival: engramsTable.isArchival })
      .from(engramsTable)
      .where(eq(engramsTable.id, engramId));
    if (!engram) {
      res.status(404).json({ error: "Engram not found" });
      return;
    }
    if (engram.isArchival) {
      res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
      return;
    }
    if (conversationId != null) {
      const [conversation] = await db
        .select({ engramId: conversations.engramId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (!conversation) {
        res.status(404).json({ error: "Conversation not found" });
        return;
      }
      if (await isArchivalEngram(conversation.engramId)) {
        res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
        return;
      }
      if (conversation.engramId !== engramId) {
        res.status(400).json({
          error: "Conversation does not belong to the requested engram",
        });
        return;
      }
    }
    const artifact = await createArtifactJob({
      engramId,
      conversationId: conversationId ?? null,
      trigger: "operator",
      kind: kind as ArtifactKind,
      title,
      prompt,
    });
    res.status(201).json(serializeArtifact(artifact));
  } catch (e) {
    req.log.error(e);
    res.status(503).json({ error: "Could not queue generation job" });
  }
});

router.get("/artifacts/:id", async (req, res) => {
  const parsed = GetArtifactParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const artifact = await loadArtifactById(parsed.data.id);
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  res.json(serializeArtifact(artifact));
});

/**
 * Stream the raw bytes for previews/downloads (NOT in the OpenAPI spec — binary
 * responses aren't modeled there). Only completed artifacts have bytes.
 */
router.get("/artifacts/:id/raw", async (req, res) => {
  const parsed = GetArtifactParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const blob = await loadArtifactBlob(parsed.data.id);
  if (!blob) {
    res.status(404).json({ error: "Artifact bytes not found" });
    return;
  }
  res.setHeader("Content-Type", blob.mimeType);
  res.setHeader("Content-Length", blob.data.length);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${blob.filename.replace(/"/g, "")}"`,
  );
  res.send(blob.data);
});

router.post("/artifacts/:id/retry", async (req, res) => {
  const parsed = RetryArtifactParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const artifact = await loadArtifactById(parsed.data.id);
  if (!artifact) {
    res.status(404).json({ error: "Artifact not found" });
    return;
  }
  if (await artifactTouchesArchive(artifact)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  if (artifact.status !== "failed") {
    res.status(400).json({ error: "Only failed artifacts can be retried." });
    return;
  }
  // The status guard lives inside requeueArtifact's UPDATE; a concurrent retry
  // that already requeued this artifact means we update zero rows here.
  const updated = await requeueArtifact(artifact.id);
  if (!updated) {
    res.status(409).json({ error: "Artifact is no longer in a failed state." });
    return;
  }
  res.json(serializeArtifact(updated));
});

router.delete("/artifacts/:id", async (req, res) => {
  const parsed = DeleteArtifactParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const artifact = await loadArtifactById(parsed.data.id);
  if (artifact && (await artifactTouchesArchive(artifact))) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const deleted = await deleteArtifact(parsed.data.id);
  res.json({ deleted });
});

export default router;
