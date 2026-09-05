import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import type { MediaAsset, EngramWorldModelEntry, MediaJobStatus } from "@workspace/db";
import {
  ListMediaQueryParams,
  GetMediaAssetParams,
  RetryMediaAssetParams,
  DeleteMediaAssetParams,
} from "@workspace/api-zod";
import { detectModality } from "../lib/media-extraction";
import {
  createMediaAsset,
  loadMediaAssets,
  loadMediaAssetById,
  loadMediaObservations,
  loadMediaBlob,
  requeueMediaAsset,
  deleteMediaAsset,
} from "../lib/media-store";
import { isArchivalEngram, ARCHIVAL_READ_ONLY_ERROR } from "../lib/archival";
import { loadOwnedConversation, loadOwnedEngram } from "../lib/account-bootstrap";

const router = Router();

async function isOwnedAsset(asset: MediaAsset, ownerId: string): Promise<boolean> {
  return asset.ownerId === ownerId;
}

/** Hard cap on a single upload's size. Defaults to 25 MiB; overridable via env. */
const MEDIA_MAX_BYTES = Number(process.env["MEDIA_MAX_BYTES"]) || 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MEDIA_MAX_BYTES, files: 1 },
});
const uploadSingle = upload.single("file");

function serializeAsset(a: MediaAsset) {
  return {
    id: a.id,
    engramId: a.engramId,
    conversationId: a.conversationId,
    filename: a.filename,
    mimeType: a.mimeType,
    modality: a.modality,
    sizeBytes: a.sizeBytes,
    status: a.status,
    summary: a.summary ?? null,
    commentary: a.commentary ?? null,
    transcript: a.transcript ?? null,
    error: a.error ?? null,
    observationCount: a.observationCount,
    startedAt: a.startedAt ? a.startedAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeObservation(e: EngramWorldModelEntry) {
  return {
    id: e.id,
    provenance: e.provenance,
    content: e.content,
    confidence: e.confidence,
    scope: e.scope,
    source: e.source ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * Multipart upload (NOT in the OpenAPI spec — multipart bodies aren't modeled there).
 * Stores the bytes and creates a pending asset; the media worker picks it up.
 */
router.post("/media", (req, res) => {
  uploadSingle(req, res, async (err: unknown) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({ error: `Upload rejected: ${err.message}` });
        return;
      }
      req.log.error(err);
      res.status(400).json({ error: "Upload failed" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided (expected field 'file')." });
      return;
    }

    const engramId = Number(req.body?.engramId);
    if (!Number.isInteger(engramId) || engramId <= 0) {
      res.status(400).json({ error: "A valid engramId is required." });
      return;
    }

    const modality = detectModality(file.mimetype);
    if (!modality) {
      res
        .status(415)
        .json({ error: `Unsupported media type: ${file.mimetype}` });
      return;
    }

    try {
      const engram = await loadOwnedEngram(engramId, req.userId!);
      if (!engram) {
        res.status(404).json({ error: "Engram not found" });
        return;
      }
      if (engram.isArchival) {
        res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
        return;
      }
      const asset = await createMediaAsset({
        ownerId: req.userId!,
        engramId,
        filename: file.originalname || "upload",
        mimeType: file.mimetype,
        modality,
        data: file.buffer,
      });
      res.status(201).json(serializeAsset(asset));
    } catch (e) {
      req.log.error(e);
      res.status(503).json({ error: "Could not store upload" });
    }
  });
});

router.get("/media", async (req, res) => {
  const parsed = ListMediaQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (parsed.data.engramId != null && !(await loadOwnedEngram(parsed.data.engramId, req.userId!))) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  const rows = await loadMediaAssets({
    ownerId: req.userId!,
    engramId: parsed.data.engramId,
    status: parsed.data.status as MediaJobStatus | undefined,
  });
  const owned = await Promise.all(rows.map(async (asset) => (await isOwnedAsset(asset, req.userId!)) ? asset : null));
  res.json(owned.filter((asset): asset is MediaAsset => asset !== null).map(serializeAsset));
});

router.get("/media/:id", async (req, res) => {
  const parsed = GetMediaAssetParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const asset = await loadMediaAssetById(parsed.data.id, req.userId!);
  if (!asset || !(await isOwnedAsset(asset, req.userId!))) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }
  const observations = await loadMediaObservations(asset.id);
  res.json({
    asset: serializeAsset(asset),
    observations: observations.map(serializeObservation),
  });
});

/**
 * Stream the raw bytes for previews (NOT in the OpenAPI spec — binary responses
 * aren't modeled there). Used by the media page's <img>/<audio>/<video> tags.
 */
router.get("/media/:id/raw", async (req, res) => {
  const parsed = GetMediaAssetParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const asset = await loadMediaAssetById(parsed.data.id, req.userId!);
  if (!asset || !(await isOwnedAsset(asset, req.userId!))) {
    res.status(404).json({ error: "Media bytes not found" });
    return;
  }
  const blob = await loadMediaBlob(parsed.data.id, req.userId!);
  if (!blob) {
    res.status(404).json({ error: "Media bytes not found" });
    return;
  }
  res.setHeader("Content-Type", blob.mimeType);
  res.setHeader("Content-Length", blob.data.length);
  res.setHeader("Content-Disposition", "inline");
  res.send(blob.data);
});

router.post("/media/:id/retry", async (req, res) => {
  const parsed = RetryMediaAssetParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const asset = await loadMediaAssetById(parsed.data.id, req.userId!);
  if (!asset || !(await isOwnedAsset(asset, req.userId!))) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }
  if (await isArchivalEngram(asset.engramId)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  if (asset.status !== "failed") {
    res
      .status(400)
      .json({ error: "Only failed assets can be retried." });
    return;
  }
  // The status guard lives inside requeueMediaAsset's UPDATE; a concurrent retry
  // that already requeued this asset means we update zero rows here.
  const updated = await requeueMediaAsset(asset.id);
  if (!updated) {
    res.status(409).json({ error: "Asset is no longer in a failed state." });
    return;
  }
  res.json(serializeAsset(updated));
});

router.delete("/media/:id", async (req, res) => {
  const parsed = DeleteMediaAssetParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await loadMediaAssetById(parsed.data.id, req.userId!);
  if (!existing || !(await isOwnedAsset(existing, req.userId!))) {
    res.status(404).json({ error: "Media asset not found" });
    return;
  }
  if (await isArchivalEngram(existing.engramId)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const deleted = await deleteMediaAsset(parsed.data.id);
  res.json({ deleted });
});

export default router;
