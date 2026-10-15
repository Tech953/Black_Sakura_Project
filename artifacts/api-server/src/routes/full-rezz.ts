import { randomUUID } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Router, type Response } from "express";
import multer from "multer";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { engramsTable, messages } from "@workspace/db/schema";
import { ARCHIVAL_READ_ONLY_ERROR } from "../lib/archival";
import { loadOwnedConversation, loadOwnedEngram } from "../lib/account-bootstrap";
import {
  bindingFromImport,
  assertFullRezzEngramWritable,
  mergeFullRezzBinding,
  readFullRezzBinding,
  splitHostSpeech,
  type FullRezzImportResult,
} from "../lib/full-rezz-contract";
import {
  cancelFullRezzJob,
  fullRezzWorkspaceForOwner,
  getFullRezzAudioPath,
  getFullRezzJob,
  getFullRezzRuntimeStatus,
  importFullRezzReferencePack,
  previewFullRezzReferencePack,
  reviewFullRezzGeneration,
  rollbackFullRezzImport,
  submitFullRezzSpeechJob,
} from "../lib/full-rezz-worker";

const router = Router();
const UPLOAD_DIR = path.join(os.tmpdir(), "engram-full-rezz-imports");
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const RATINGS = [
  "likeness",
  "naturalness",
  "delivery",
  "reference_purity",
  "canon_boundaries",
] as const;

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      void mkdir(UPLOAD_DIR, { recursive: true })
        .then(() => callback(null, UPLOAD_DIR))
        .catch((error: unknown) => callback(error as Error, UPLOAD_DIR));
    },
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.zip`),
  }),
  limits: { fileSize: MAX_PACK_BYTES, files: 1 },
}).single("file");

function positiveInteger(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function sendUploadError(error: unknown, res: Response): void {
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Reference-pack ZIP exceeds the 256 MiB upload limit."
          : "Reference-pack upload was rejected.",
    });
    return;
  }
  res.status(400).json({ error: "Reference-pack upload could not be read." });
}

router.get("/full-rezz/status", (_req, res) => {
  res.json(getFullRezzRuntimeStatus());
});

router.get("/full-rezz/engrams/:id/binding", async (req, res) => {
  const engramId = positiveInteger(req.params.id);
  if (engramId == null) {
    res.status(400).json({ error: "Invalid engram ID." });
    return;
  }
  const engram = await loadOwnedEngram(engramId, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found." });
    return;
  }
  const binding = readFullRezzBinding(engram.voiceProfile);
  res.json({
    engramId,
    isArchival: engram.isArchival,
    bound: binding !== null,
    ...(binding
      ? {
          profileId: binding.voice_profile_id,
          originalProfileId: binding.original_profile_id,
          packId: binding.pack_id,
          autoSpeak: binding.auto_speak,
        }
      : {}),
  });
});

router.post("/full-rezz/import-preview", (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      sendUploadError(error, res);
      return;
    }
    next();
  });
}, async (req, res) => {
  const runtime = getFullRezzRuntimeStatus();
  if (!runtime.available) {
    if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
    res.status(503).json({ error: runtime.reason });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Upload a FULL_REZZ reference-pack ZIP." });
    return;
  }
  try {
    const preview = await previewFullRezzReferencePack(req.userId!, req.file.path);
    const profiles = Array.isArray(preview.profiles) ? preview.profiles : [];
    res.json({
      packId: preview.pack_id,
      schemaVersion: preview.schema_version,
      manifestSha256: preview.manifest_sha256,
      profileCount: preview.profile_count,
      profiles: profiles
        .filter((profile): profile is Record<string, unknown> => typeof profile === "object" && profile !== null)
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          referenceCount: profile.reference_count,
          sourceCount: profile.source_count,
        })),
    });
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message.slice(0, 1200) : "Reference-pack preview failed.",
    });
  } finally {
    await unlink(req.file.path).catch(() => undefined);
  }
});

router.post("/full-rezz/engrams/:id/import", (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      sendUploadError(error, res);
      return;
    }
    next();
  });
}, async (req, res) => {
  const engramId = positiveInteger(req.params.id);
  const originalProfileId = req.body?.originalProfileId;
  if (engramId == null || typeof originalProfileId !== "string") {
    if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
    res.status(400).json({ error: "Select a writable engram and an original profile ID." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Upload a FULL_REZZ reference-pack ZIP." });
    return;
  }
  const engram = await loadOwnedEngram(engramId, req.userId!);
  if (!engram) {
    await unlink(req.file.path).catch(() => undefined);
    res.status(404).json({ error: "Engram not found." });
    return;
  }
  try {
    assertFullRezzEngramWritable(engram, ARCHIVAL_READ_ONLY_ERROR);
  } catch {
    await unlink(req.file.path).catch(() => undefined);
    res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const runtime = getFullRezzRuntimeStatus();
  if (!runtime.available) {
    await unlink(req.file.path).catch(() => undefined);
    res.status(503).json({ error: runtime.reason });
    return;
  }

  let importId: string | undefined;
  try {
    const result = (await importFullRezzReferencePack(
      req.userId!,
      req.file.path,
    )) as unknown as FullRezzImportResult;
    if (typeof result?.receipt?.import_id === "string") {
      importId = result.receipt.import_id;
    }
    const binding = bindingFromImport(result, originalProfileId);
    importId = binding.import_id;
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(engramsTable)
        .where(and(eq(engramsTable.id, engramId), eq(engramsTable.ownerId, req.userId!)))
        .limit(1);
      if (!current) throw new Error("Engram not found.");
      assertFullRezzEngramWritable(current, ARCHIVAL_READ_ONLY_ERROR);
      const [updated] = await tx
        .update(engramsTable)
        .set({
          voiceProfile: mergeFullRezzBinding(
            current.voiceProfile as unknown as Record<string, unknown>,
            binding,
          ) as unknown as typeof engramsTable.$inferInsert.voiceProfile,
        })
        .where(
          and(
            eq(engramsTable.id, engramId),
            eq(engramsTable.ownerId, req.userId!),
            eq(engramsTable.isArchival, false),
          ),
        )
        .returning({ id: engramsTable.id });
      if (!updated) throw new Error(ARCHIVAL_READ_ONLY_ERROR);
    });
    res.status(201).json({
      engramId,
      binding: {
        packId: binding.pack_id,
        originalProfileId: binding.original_profile_id,
        voiceProfileId: binding.voice_profile_id,
        sourceArchiveSha256: binding.source_archive_sha256,
        sourceManifestSha256: binding.source_manifest_sha256,
        importedAt: binding.imported_at,
        autoSpeak: binding.auto_speak,
        engramKey: binding.engram_key,
      },
      note:
        "Profile context and source files were imported as preserved data. Authored prompts are not applied to host policy.",
    });
  } catch (error) {
    if (importId) {
      try {
        await rollbackFullRezzImport(req.userId!, importId);
      } catch (rollbackError) {
        console.error("FULL_REZZ import rollback failed", rollbackError);
      }
    }
    const message = error instanceof Error ? error.message : "Reference-pack import failed.";
    res.status(message === ARCHIVAL_READ_ONLY_ERROR ? 409 : 422).json({
      error: message.slice(0, 1200),
    });
  } finally {
    await unlink(req.file.path).catch(() => undefined);
  }
});

router.post(
  "/full-rezz/conversations/:conversationId/messages/:messageId/speech",
  async (req, res) => {
    const conversationId = positiveInteger(req.params.conversationId);
    const messageId = positiveInteger(req.params.messageId);
    if (conversationId == null || messageId == null) {
      res.status(400).json({ error: "Invalid conversation or message ID." });
      return;
    }
    const conversation = await loadOwnedConversation(conversationId, req.userId!);
    if (!conversation || conversation.engramId == null) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    if (conversation.archivedAt) {
      res.status(409).json({ error: "Archived conversations cannot start new speech jobs." });
      return;
    }
    const engram = await loadOwnedEngram(conversation.engramId, req.userId!);
    if (!engram) {
      res.status(404).json({ error: "Engram not found." });
      return;
    }
    if (engram.isArchival) {
      res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
      return;
    }
    const [message] = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.conversationId, conversationId),
          eq(messages.role, "assistant"),
          eq(messages.speakerEngramId, engram.id),
        ),
      )
      .limit(1);
    if (!message) {
      res.status(404).json({ error: "No saved assistant reply from this engram was found." });
      return;
    }
    const binding = readFullRezzBinding(engram.voiceProfile);
    if (!binding) {
      res.status(409).json({ error: "Import and bind a FULL_REZZ voice profile first." });
      return;
    }
    const runtime = getFullRezzRuntimeStatus();
    if (!runtime.available) {
      res.status(503).json({ error: runtime.reason });
      return;
    }
    try {
      splitHostSpeech(message.content);
      const body = req.body ?? {};
      const style = typeof body.style === "string" && body.style.trim()
        ? body.style.trim().slice(0, 80)
        : "neutral";
      const rate = typeof body.rate === "number" ? body.rate : 1;
      const steps = body.steps === 32 ? 32 : body.steps === 16 || body.steps == null ? 16 : null;
      const seed = body.seed == null ? 42 : body.seed;
      if (!Number.isFinite(rate) || rate < 0.5 || rate > 1.5) {
        res.status(400).json({ error: "Speech rate must be from 0.5 to 1.5." });
        return;
      }
      if (steps == null) {
        res.status(400).json({ error: "Sampling steps must be 16 or 32." });
        return;
      }
      if (!Number.isSafeInteger(seed) || seed < 0 || seed >= 2 ** 31) {
        res.status(400).json({ error: "Speech seed must be a non-negative 31-bit integer." });
        return;
      }
      const job = await submitFullRezzSpeechJob({
        ownerId: req.userId!,
        engramId: engram.id,
        messageId: message.id,
        profileId: binding.voice_profile_id,
        text: message.content,
        settings: {
          style,
          rate,
          steps,
          seed,
          speech_engine: "f5",
          synthesis_language: "en",
        },
      });
      res.status(202).json(job);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to start FULL_REZZ speech.",
      });
    }
  },
);

router.get("/full-rezz/jobs/:id", async (req, res) => {
  try {
    const job = await getFullRezzJob(req.userId!, req.params.id);
    if (!job) {
      res.status(404).json({ error: "FULL_REZZ job not found." });
      return;
    }
    res.json(job);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "FULL_REZZ is unavailable." });
  }
});

router.delete("/full-rezz/jobs/:id", async (req, res) => {
  try {
    const job = await cancelFullRezzJob(req.userId!, req.params.id);
    if (!job) {
      res.status(404).json({ error: "FULL_REZZ job not found." });
      return;
    }
    res.json(job);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "FULL_REZZ is unavailable." });
  }
});

router.get("/full-rezz/jobs/:id/audio", async (req, res) => {
  try {
    const audioPath = await getFullRezzAudioPath(req.userId!, req.params.id);
    if (!audioPath) {
      res.status(404).json({ error: "FULL_REZZ audio is not available." });
      return;
    }
    res.type("audio/wav").sendFile(audioPath, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({ error: "Unable to read the completed FULL_REZZ audio." });
      }
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "FULL_REZZ is unavailable." });
  }
});

router.post("/full-rezz/jobs/:id/review", async (req, res) => {
  const job = await getFullRezzJob(req.userId!, req.params.id);
  if (!job) {
    res.status(404).json({ error: "FULL_REZZ job not found." });
    return;
  }
  const engram = await loadOwnedEngram(job.engramId, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found." });
    return;
  }
  if (engram.isArchival) {
    res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  try {
    fullRezzWorkspaceForOwner(req.userId!);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "FULL_REZZ is unavailable." });
    return;
  }
  const generationId = req.body?.generationId;
  if (
    typeof generationId !== "string" ||
    !/^gen_[a-f0-9]{16}$/.test(generationId) ||
    !job.generationIds?.includes(generationId)
  ) {
    res.status(400).json({ error: "Review must target a generation produced by this job." });
    return;
  }
  const ratings = req.body?.ratings;
  if (
    !ratings ||
    typeof ratings !== "object" ||
    Array.isArray(ratings) ||
    Object.keys(ratings).sort().join(",") !== [...RATINGS].sort().join(",") ||
    RATINGS.some(
      (key) =>
        !["acceptable", "needs_revision"].includes(ratings[key]),
    )
  ) {
    res.status(400).json({
      error: "Rate all five dimensions as acceptable or needs_revision before saving a review.",
    });
    return;
  }
  const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 10_000) : "";
  try {
    const result = await reviewFullRezzGeneration(
      req.userId!,
      generationId,
      ratings as Record<string, string>,
      notes,
    );
    res.json({ generationId, review: result.human_review, reviewedAt: result.reviewed_at ?? null });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Review could not be saved." });
  }
});

export default router;
