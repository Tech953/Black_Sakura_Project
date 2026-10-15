import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
  exportFullRezzHistory,
  fullRezzWorkspaceForOwner,
  getFullRezzMoviePath,
  getFullRezzAudioPath,
  getFullRezzJob,
  getFullRezzRuntimeStatus,
  importFullRezzHistory,
  listFullRezzHistory,
  importFullRezzReferencePack,
  previewFullRezzHistory,
  previewFullRezzReferencePack,
  reviewFullRezzGeneration,
  rollbackFullRezzHistoryImport,
  rollbackFullRezzImport,
  submitFullRezzMovieExportJob,
  submitFullRezzSpeechJob,
} from "../lib/full-rezz-worker";

const router = Router();
const UPLOAD_DIR = path.join(os.tmpdir(), "engram-full-rezz-imports");
const MAX_PACK_BYTES = 256 * 1024 * 1024;
const MAX_HISTORY_BYTES = 128 * 1024 * 1024;
const RATINGS = [
  "likeness",
  "naturalness",
  "delivery",
  "reference_purity",
  "canon_boundaries",
] as const;
const STUDIO_UNIT_ASSETS = new Set([
  "character.json",
  "front.png",
  "front_three_quarter.png",
  "low_angle.png",
  "profile.png",
  "rear.png",
  "rear_three_quarter.png",
  "studio_unit.gltf",
]);

function studioUnitAssetRoot(): string | null {
  const candidates = [
    process.env.FULL_REZZ_ROOT
      ? path.join(
          path.resolve(process.env.FULL_REZZ_ROOT),
          "character_assets",
          "studio_unit",
        )
      : null,
    path.resolve(
      process.cwd(),
      "../desktop/full-rezz/character_assets/studio_unit",
    ),
    path.resolve(
      process.cwd(),
      "artifacts/desktop/full-rezz/character_assets/studio_unit",
    ),
  ].filter((candidate): candidate is string => candidate !== null);
  return (
    candidates.find((candidate) =>
      existsSync(path.join(candidate, "character.json")),
    ) ?? null
  );
}

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
const historyUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      void mkdir(UPLOAD_DIR, { recursive: true })
        .then(() => callback(null, UPLOAD_DIR))
        .catch((error: unknown) => callback(error as Error, UPLOAD_DIR));
    },
    filename: (_req, _file, callback) => callback(null, `${randomUUID()}.history`),
  }),
  limits: { fileSize: MAX_HISTORY_BYTES, files: 1 },
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

function sendHistoryUploadError(error: unknown, res: Response): void {
  if (error instanceof multer.MulterError) {
    res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
      error:
        error.code === "LIMIT_FILE_SIZE"
          ? "Conversation history exceeds the 128 MiB import limit."
          : "Conversation history upload was rejected.",
    });
    return;
  }
  res.status(400).json({ error: "Conversation history upload could not be read." });
}

function historyMapping(value: unknown): Record<string, unknown> {
  if (value == null || value === "") return {};
  if (typeof value !== "string" || value.length > 8192) {
    throw new Error("History mapping must be JSON text of at most 8 KiB.");
  }
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("History mapping must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

router.get("/full-rezz/status", (_req, res) => {
  res.json(getFullRezzRuntimeStatus());
});

router.get("/full-rezz/studio-unit/assets/:name", (req, res) => {
  const name = req.params.name;
  if (!STUDIO_UNIT_ASSETS.has(name)) {
    res.status(404).json({ error: "Studio Unit asset was not found." });
    return;
  }
  const root = studioUnitAssetRoot();
  if (!root) {
    res.status(503).json({ error: "Studio Unit assets are not staged in this build." });
    return;
  }
  res.type(
    name.endsWith(".png")
      ? "image/png"
      : name.endsWith(".gltf")
        ? "model/gltf+json"
        : "application/json",
  );
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.sendFile(path.join(root, name), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: "Studio Unit asset was not found." });
    }
  });
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

router.get("/full-rezz/engrams/:id/history", async (req, res) => {
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
  if (engram.isArchival) {
    res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const binding = readFullRezzBinding(engram.voiceProfile);
  if (!binding) {
    res.status(409).json({ error: "Bind a FULL_REZZ profile before accessing its history." });
    return;
  }
  const runtime = getFullRezzRuntimeStatus();
  if (!runtime.available) {
    res.status(503).json({ error: runtime.reason });
    return;
  }
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  const offset = req.query.offset == null ? 0 : Number(req.query.offset);
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    res.status(400).json({ error: "History pages accept limit 1–200 and a non-negative offset." });
    return;
  }
  try {
    res.json(
      await listFullRezzHistory(req.userId!, binding.voice_profile_id, limit, offset),
    );
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message.slice(0, 1200) : "History could not be loaded.",
    });
  }
});

router.get("/full-rezz/engrams/:id/history/export", async (req, res) => {
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
  if (engram.isArchival) {
    res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const binding = readFullRezzBinding(engram.voiceProfile);
  if (!binding) {
    res.status(409).json({ error: "Bind a FULL_REZZ profile before exporting its history." });
    return;
  }
  const runtime = getFullRezzRuntimeStatus();
  if (!runtime.available) {
    res.status(503).json({ error: runtime.reason });
    return;
  }
  try {
    const exportPath = await exportFullRezzHistory(
      req.userId!,
      binding.voice_profile_id,
    );
    res.type("application/json");
    res.download(
      exportPath,
      `engram-${engramId}-full-rezz-history.json`,
      (error) => {
        if (error && !res.headersSent) {
          res.status(500).json({ error: "FULL_REZZ history export could not be downloaded." });
        }
      },
    );
  } catch (error) {
    res.status(503).json({
      error: error instanceof Error ? error.message.slice(0, 1200) : "History export failed.",
    });
  }
});

router.post(
  "/full-rezz/engrams/:id/history/import-preview",
  (req, res, next) => {
    historyUpload(req, res, (error) => {
      if (error) {
        sendHistoryUploadError(error, res);
        return;
      }
      next();
    });
  },
  async (req, res) => {
    if (req.aborted || res.destroyed) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      return;
    }
    const engramId = positiveInteger(req.params.id);
    if (engramId == null) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(400).json({ error: "Invalid engram ID." });
      return;
    }
    const engram = await loadOwnedEngram(engramId, req.userId!);
    if (!engram) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(404).json({ error: "Engram not found." });
      return;
    }
    if (engram.isArchival) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
      return;
    }
    const binding = readFullRezzBinding(engram.voiceProfile);
    if (!binding) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(409).json({ error: "Bind a FULL_REZZ profile before importing history." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Choose a JSON, JSONL, CSV, TXT or MD history file." });
      return;
    }
    if (!getFullRezzRuntimeStatus().available) {
      await unlink(req.file.path).catch(() => undefined);
      res.status(503).json({ error: getFullRezzRuntimeStatus().reason });
      return;
    }
    try {
      const mapping = historyMapping(req.body?.mapping);
      const preview = await previewFullRezzHistory(
        req.userId!,
        binding.voice_profile_id,
        req.file.path,
        path.basename(req.file.originalname).slice(0, 255),
        mapping,
      );
      res.json(preview);
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message.slice(0, 1200) : "History preview failed.",
      });
    } finally {
      await unlink(req.file.path).catch(() => undefined);
    }
  },
);

router.post(
  "/full-rezz/engrams/:id/history/import",
  (req, res, next) => {
    historyUpload(req, res, (error) => {
      if (error) {
        sendHistoryUploadError(error, res);
        return;
      }
      next();
    });
  },
  async (req, res) => {
    if (req.aborted || res.destroyed) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      return;
    }
    const engramId = positiveInteger(req.params.id);
    if (engramId == null) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(400).json({ error: "Invalid engram ID." });
      return;
    }
    const engram = await loadOwnedEngram(engramId, req.userId!);
    if (!engram) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(404).json({ error: "Engram not found." });
      return;
    }
    if (engram.isArchival) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
      return;
    }
    const binding = readFullRezzBinding(engram.voiceProfile);
    if (!binding) {
      if (req.file?.path) await unlink(req.file.path).catch(() => undefined);
      res.status(409).json({ error: "Bind a FULL_REZZ profile before importing history." });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Choose a JSON, JSONL, CSV, TXT or MD history file." });
      return;
    }
    if (!getFullRezzRuntimeStatus().available) {
      await unlink(req.file.path).catch(() => undefined);
      res.status(503).json({ error: getFullRezzRuntimeStatus().reason });
      return;
    }
    try {
      const mapping = historyMapping(req.body?.mapping);
      const imported = await importFullRezzHistory(
        req.userId!,
        binding.voice_profile_id,
        req.file.path,
        mapping,
      );
      res.status(201).json(imported);
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message.slice(0, 1200) : "History import failed.",
      });
    } finally {
      await unlink(req.file.path).catch(() => undefined);
    }
  },
);

router.delete(
  "/full-rezz/engrams/:id/history/imports/:importId",
  async (req, res) => {
    const engramId = positiveInteger(req.params.id);
    if (engramId == null || !/^import_[a-f0-9]{32}$/.test(req.params.importId)) {
      res.status(400).json({ error: "Invalid engram or history import ID." });
      return;
    }
    const engram = await loadOwnedEngram(engramId, req.userId!);
    if (!engram) {
      res.status(404).json({ error: "Engram not found." });
      return;
    }
    if (engram.isArchival) {
      res.status(409).json({ error: ARCHIVAL_READ_ONLY_ERROR });
      return;
    }
    const binding = readFullRezzBinding(engram.voiceProfile);
    if (!binding) {
      res.status(409).json({ error: "Bind a FULL_REZZ profile before rolling back history." });
      return;
    }
    if (req.body?.confirm !== true) {
      res.status(400).json({
        error: "Explicit confirmation is required to remove imported messages and source bytes.",
      });
      return;
    }
    const runtime = getFullRezzRuntimeStatus();
    if (!runtime.available) {
      res.status(503).json({ error: runtime.reason });
      return;
    }
    try {
      res.json(
        await rollbackFullRezzHistoryImport(
          req.userId!,
          binding.voice_profile_id,
          req.params.importId,
        ),
      );
    } catch (error) {
      res.status(422).json({
        error: error instanceof Error ? error.message.slice(0, 1200) : "History rollback failed.",
      });
    }
  },
);

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
        conversationId: conversation.id,
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

router.post(
  "/full-rezz/conversations/:conversationId/messages/:messageId/movie-export",
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
      res.status(409).json({ error: "Archived conversations cannot start movie exports." });
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
      res.status(409).json({ error: "Import and bind a FULL_REZZ profile first." });
      return;
    }
    const runtime = getFullRezzRuntimeStatus();
    if (!runtime.available) {
      res.status(503).json({ error: runtime.reason });
      return;
    }
    const body = req.body ?? {};
    const mode = body.mode === "2d" || body.mode === "3d" ? body.mode : "3d";
    const fps = body.fps == null ? 60 : body.fps;
    const viewId =
      typeof body.viewId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(body.viewId)
        ? body.viewId
        : "front";
    const width = body.width == null ? 1280 : body.width;
    const height = body.height == null ? 720 : body.height;
    if (![60, 120, 240].includes(fps)) {
      res.status(400).json({ error: "Choose a movie frame rate of 60, 120 or 240 fps." });
      return;
    }
    try {
      const job = await submitFullRezzMovieExportJob({
        ownerId: req.userId!,
        engramId: engram.id,
        conversationId: conversation.id,
        messageId: message.id,
        profileId: binding.voice_profile_id,
        mode,
        viewId,
        action: "talk",
        fps: fps as 60 | 120 | 240,
        width,
        height,
        clip: mode === "3d" ? 0 : null,
      });
      res.status(202).json(job);
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Unable to start FULL_REZZ movie export.",
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

router.get("/full-rezz/jobs/:id/video", async (req, res) => {
  try {
    const videoPath = await getFullRezzMoviePath(req.userId!, req.params.id, "video");
    if (!videoPath) {
      res.status(404).json({ error: "FULL_REZZ movie is not available." });
      return;
    }
    res.type("video/webm").sendFile(videoPath, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({ error: "Unable to read the completed FULL_REZZ movie." });
      }
    });
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : "FULL_REZZ is unavailable." });
  }
});

router.get("/full-rezz/jobs/:id/audit", async (req, res) => {
  try {
    const auditPath = await getFullRezzMoviePath(req.userId!, req.params.id, "audit");
    if (!auditPath) {
      res.status(404).json({ error: "FULL_REZZ movie audit is not available." });
      return;
    }
    res.type("application/json").sendFile(auditPath, (error) => {
      if (error && !res.headersSent) {
        res.status(500).json({ error: "Unable to read the completed FULL_REZZ movie audit." });
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
