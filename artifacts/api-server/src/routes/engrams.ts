import { Router } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { responseLanguageInstruction } from "@workspace/i18n";
import {
  engramsTable,
  engramTransmissionsTable,
  engramInquiriesTable,
  engramWorldModelTable,
} from "@workspace/db/schema";
import type { Engram, EmotionalBaseline } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  GetEngramParams,
  UpdateEngramConfigParams,
  UpdateEngramConfigBody,
  ActivateEngramParams,
  TransmitEngramParams,
  ListEngramTransmissionsParams,
  MarkTransmissionsSeenParams,
  MarkTransmissionsSeenBody,
  ListEngramInquiriesParams,
  CreateEngramInquiryParams,
  CreateEngramInquiryBody,
  ConfirmEngramCsvImportBody,
} from "@workspace/api-zod";
import { runTick, forceTransmission, COOLDOWN_MS } from "../services/engram-engine";
import {
  generateProbeResponse,
  generateDevelopment,
  generateEngramSynthesis,
} from "../lib/engram-generation";
import { llmProviderFailureResponse } from "../lib/llm";
import {
  MAX_ENGRAM_CSV_BYTES,
  parseEngramCsv,
} from "../lib/engram-csv-parser";
import {
  generateEngramImportDraft,
  MAX_ENGRAM_IMPORT_PROMPT_CHARS,
  MAX_ENGRAM_IMPORT_PROMPT_ROWS,
  sanitizeEngramImportConfirmation,
} from "../lib/engram-import";
import { engramImportDraftStore } from "../lib/engram-import-store";

const router = Router();

const TRANSMISSION_LIST_CAP = 100;
const MAX_FACTS = 30;
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ENGRAM_CSV_BYTES, files: 1 },
});
const uploadCsv = csvUpload.single("file");

function uniqueEngramSlug(name: string, takenSlugs: string[]): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "imported";
  const taken = new Set(takenSlugs);
  let slug = base;
  for (let suffix = 2; taken.has(slug); suffix += 1) {
    slug = `${base}-${suffix}`;
  }
  return slug;
}

async function loadEngram(id: number, ownerId: string): Promise<Engram | undefined> {
  const [row] = await db.select().from(engramsTable).where(
    and(eq(engramsTable.id, id), eq(engramsTable.ownerId, ownerId)),
  );
  return row;
}

/**
 * Archival branches (e.g. "Full Rezz") are preserved read-only for continuity
 * fidelity: no config changes, tuning, transmissions, or activation. Returns
 * true (and sends a 403) when the engram is archival.
 */
function rejectIfArchival(engram: Engram, res: Parameters<Parameters<typeof router.post>[1]>[1]): boolean {
  if (!engram.isArchival) return false;
  res.status(403).json({
    error:
      "This engram is a permanent archival branch preserved for continuity fidelity. It is read-only and cannot be altered.",
  });
  return true;
}

router.get("/engrams", async (req, res) => {
  const rows = await db.select().from(engramsTable).where(eq(engramsTable.ownerId, req.userId!)).orderBy(engramsTable.id);
  res.json(rows);
});

// Must be registered before "/engrams/:id" so "tick" is not parsed as an id.
router.post("/engrams/tick", async (req, res) => {
  const result = await runTick({ force: true, ownerId: req.userId! });
  res.json(result);
});

// Synthesize a brand-new engram from the processed local archive plus operator
// stipulations ("neural plasticity emulation"). Only OBSERVED / designer-grade
// provenance material (observed, remembered) feeds synthesis — simulated or
// inferred content must never seed a real persona (quarantine invariant).
// Must be registered before "/engrams/:id" so "synthesize" is not parsed as an id.
router.post("/engrams/synthesize", async (req, res) => {
  const body = req.body as { stipulations?: unknown; sourceEngramIds?: unknown };
  const stipulations =
    typeof body.stipulations === "string" ? body.stipulations.trim().slice(0, 2000) : "";
  if (!stipulations) {
    res.status(400).json({ error: "stipulations (a non-empty string) is required" });
    return;
  }
  const sourceEngramIds = Array.isArray(body.sourceEngramIds)
    ? body.sourceEngramIds.filter((x): x is number => typeof x === "number")
    : [];

  const existing = await db.select().from(engramsTable).where(eq(engramsTable.ownerId, req.userId!));

  // Gather grounded archive material: observed/remembered world-model entries,
  // optionally restricted to specific source engrams.
  // World-model rows derive their ownership from the engram. Resolve all
  // requested IDs against the caller first; foreign IDs deliberately behave as
  // absent and can never contribute prompt material.
  const allowedIds = existing.map((engram) => engram.id);
  if (sourceEngramIds.some((id) => !allowedIds.includes(id))) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  const conditions = [
    inArray(engramWorldModelTable.provenance, ["observed", "remembered"]),
    inArray(
      engramWorldModelTable.engramId,
      sourceEngramIds.length ? sourceEngramIds : allowedIds,
    ),
  ];
  const entries = await db
    .select()
    .from(engramWorldModelTable)
    .where(and(...conditions))
    .orderBy(desc(engramWorldModelTable.createdAt))
    .limit(80);

  const nameById = new Map(existing.map((e) => [e.id, e.name]));
  const archiveDigest = entries
    .map(
      (e) =>
        `- [${e.provenance}${nameById.has(e.engramId) ? ` via ${nameById.get(e.engramId)}` : ""}] ${e.content.replace(/\s+/g, " ").slice(0, 240)}`,
    )
    .join("\n");

  let synthesized;
  try {
    synthesized = await generateEngramSynthesis({
      stipulations,
      archiveDigest,
      existingNames: existing.map((e) => e.name),
    });
  } catch (error) {
    req.log.error({ err: error }, "engram synthesis provider failed");
    res.status(503).json(llmProviderFailureResponse(error));
    return;
  }
  if (!synthesized) {
    res.status(502).json({ error: "Synthesis failed — the model did not return a usable engram config. Try again or refine the stipulations." });
    return;
  }

  // Unique slug from the name.
  const baseSlug =
    synthesized.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "synthesized";
  const taken = new Set(existing.map((e) => e.slug));
  let slug = baseSlug;
  for (let i = 2; taken.has(slug); i++) slug = `${baseSlug}-${i}`;

  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: req.userId!,
      slug,
      name: synthesized.name,
      title: synthesized.title,
      symbol: synthesized.symbol,
      origin: synthesized.origin,
      voiceProfile: synthesized.voiceProfile,
      emotionalBaseline: synthesized.emotionalBaseline,
      environmentAnchor: synthesized.environmentAnchor,
      memorySeed: synthesized.memorySeed,
      guardrails: synthesized.guardrails,
      drives: synthesized.drives,
      focusThemes: synthesized.focusThemes,
      // New engrams wake up autonomous but in the default bounded mode; all
      // rate caps, quiet hours and the human-contact bus apply as usual.
      autonomyEnabled: true,
      mode: "full_bounded",
    })
    .returning();

  res.status(201).json(row);
});

// Multipart upload is intentionally handled outside generated request-body
// validation because @workspace/api-zod is shared with Node and cannot safely
// reference browser File/Blob globals. The response and confirm body remain
// contract-first and generated from OpenAPI.
router.post("/engrams/import-csv/preview", (req, res) => {
  uploadCsv(req, res, async (uploadError: unknown) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError) {
        const status = uploadError.code === "LIMIT_FILE_SIZE" ? 413 : 400;
        res.status(status).json({ error: `Upload rejected: ${uploadError.message}` });
        return;
      }
      req.log.error(uploadError);
      res.status(400).json({ error: "Upload failed" });
      return;
    }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No CSV file provided (expected field 'file')." });
      return;
    }

    const filename =
      file.originalname.split(/[\\/]/).pop()?.trim().slice(0, 255) || "transcript.csv";
    const parsed = parseEngramCsv(file.buffer, filename);
    if (!parsed.ok) {
      const unsupportedCodes = new Set([
        "INVALID_FILENAME",
        "BINARY_INPUT",
        "INVALID_CSV_CONTENT",
      ]);
      res
        .status(unsupportedCodes.has(parsed.error.code) ? 415 : 400)
        .json({ error: parsed.error.message });
      return;
    }
    if (parsed.rows.length === 0) {
      res.status(400).json({ error: "The CSV did not contain any usable transcript rows." });
      return;
    }

    const stipulations =
      typeof req.body?.stipulations === "string"
        ? req.body.stipulations.trim().slice(0, 2000)
        : "";

    try {
      const draft = await generateEngramImportDraft({
        rows: parsed.rows,
        stipulations,
      });
      if (!draft) {
        res.status(502).json({
          error:
            "Draft generation failed — the model did not return a usable engram preview.",
        });
        return;
      }

      const draftId = engramImportDraftStore.create(draft);
      const expiresAt = engramImportDraftStore.expiresAt(draftId);
      const warnings = [...parsed.warnings];
      const charactersAccepted = parsed.rows.reduce(
        (total, row) => total + row.content.length,
        0,
      );
      if (
        parsed.rows.length > MAX_ENGRAM_IMPORT_PROMPT_ROWS ||
        charactersAccepted > MAX_ENGRAM_IMPORT_PROMPT_CHARS
      ) {
        warnings.push({
          code: "SYNTHESIS_SAMPLE_TRUNCATED",
          message:
            "The full CSV was parsed, but draft synthesis used a bounded sample. Review the generated draft carefully.",
          row: null,
        });
      }
      const skippedCodes = new Set([
        "SKIPPED_EMPTY_CONTENT",
        "SKIPPED_AMBIGUOUS_ROW",
        "TRUNCATED_ROWS",
        "TRUNCATED_TOTAL_TEXT",
      ]);
      res.json({
        draftId,
        expiresAt: new Date(expiresAt ?? Date.now()).toISOString(),
        source: {
          filename,
          rowsAccepted: parsed.rows.length,
          rowsSkipped: warnings.filter((warning) =>
            skippedCodes.has(warning.code),
          ).length,
          charactersAccepted,
          warnings,
        },
        draft,
      });
    } catch (error) {
      req.log.error(error);
      res.status(502).json({ error: "Draft generation is currently unavailable." });
    }
  });
});

router.post("/engrams/import-csv/confirm", async (req, res) => {
  const parsedBody = ConfirmEngramCsvImportBody.safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Invalid import confirmation." });
    return;
  }

  const { draftId } = parsedBody.data;
  const confirmed = sanitizeEngramImportConfirmation(parsedBody.data.draft);
  if (!confirmed) {
    res.status(400).json({
      error:
        "The edited draft contains invalid settings or an unsafe memory provenance choice.",
    });
    return;
  }

  const draftStatus = engramImportDraftStore.status(draftId);
  if (draftStatus === "missing") {
    res.status(410).json({ error: "This import draft has expired. Upload the CSV again." });
    return;
  }
  if (!engramImportDraftStore.beginConfirm(draftId)) {
    res.status(409).json({ error: "This import draft is already being confirmed or was used." });
    return;
  }

  try {
    const row = await db.transaction(async (tx) => {
      const existing = await tx.select().from(engramsTable).where(eq(engramsTable.ownerId, req.userId!));
      const slug = uniqueEngramSlug(
        confirmed.name,
        existing.map((engram) => engram.slug),
      );
      const [created] = await tx
        .insert(engramsTable)
        .values({
          ownerId: req.userId!,
          slug,
          name: confirmed.name,
          title: confirmed.title,
          symbol: confirmed.symbol,
          origin: confirmed.origin,
          voiceProfile: confirmed.voiceProfile,
          emotionalBaseline: confirmed.emotionalBaseline,
          environmentAnchor: confirmed.environmentAnchor,
          memorySeed: confirmed.memorySeed,
          guardrails: confirmed.guardrails,
          drives: confirmed.drives,
          focusThemes: confirmed.focusThemes,
          autonomyEnabled: confirmed.autonomyEnabled,
          tickCadenceSeconds: confirmed.tickCadenceSeconds,
          initiationThreshold: confirmed.initiationThreshold,
          mode: confirmed.mode,
          humanContactEnabled: confirmed.humanContactEnabled,
          simulationEnabled: confirmed.simulationEnabled,
          artifactGenerationEnabled: confirmed.artifactGenerationEnabled,
          isArchival: false,
          driveState: {},
          currentMood: confirmed.emotionalBaseline.mood,
          isChatActive: false,
        })
        .returning();
      if (!created) throw new Error("Engram insert did not return a row");

      if (confirmed.memoryCandidates.length > 0) {
        await tx.insert(engramWorldModelTable).values(
          confirmed.memoryCandidates.map((candidate) => ({
            engramId: created.id,
            provenance: candidate.provenance,
            content: candidate.content,
            confidence:
              candidate.provenance === "remembered"
                ? 0.85
                : candidate.provenance === "inferred"
                  ? 0.65
                  : 0.5,
            scope: "private",
            source: `csv-import:${draftId}`,
          })),
        );
      }

      return created;
    });

    engramImportDraftStore.consume(draftId);
    res.status(201).json(row);
  } catch (error) {
    engramImportDraftStore.release(draftId);
    req.log.error(error);
    res.status(500).json({ error: "Engram creation failed; the draft can be retried." });
  }
});

// Must be registered before "/engrams/:id" so "state" is not parsed as an id.
router.get("/engrams/state", async (req, res) => {
  const rows = await db.select().from(engramsTable).where(eq(engramsTable.ownerId, req.userId!)).orderBy(engramsTable.id);
  const now = Date.now();
  const states = rows.map((e) => {
    const driveState = e.driveState ?? {};
    const drives = e.drives.map((d) => {
      const pressure = typeof driveState[d.id] === "number" ? driveState[d.id] : 0;
      return { id: d.id, label: d.label, pressure, weight: d.weight, charge: pressure * d.weight };
    });
    const topCharge = drives.reduce((max, d) => Math.max(max, d.charge), 0);

    const backoffUntilMs = e.backoffUntil ? new Date(e.backoffUntil).getTime() : 0;
    const inBackoff = now < backoffUntilMs;
    const cooldownUntilMs = e.lastTransmissionAt
      ? new Date(e.lastTransmissionAt).getTime() + COOLDOWN_MS
      : 0;
    const inCooldown = now < cooldownUntilMs;

    return {
      engramId: e.id,
      autonomyEnabled: e.autonomyEnabled,
      currentMood: e.currentMood,
      initiationThreshold: e.initiationThreshold,
      tickCadenceSeconds: e.tickCadenceSeconds,
      lastTickAt: e.lastTickAt ? new Date(e.lastTickAt).toISOString() : null,
      lastTransmissionAt: e.lastTransmissionAt ? new Date(e.lastTransmissionAt).toISOString() : null,
      backoffUntil: inBackoff ? new Date(backoffUntilMs).toISOString() : null,
      inBackoff,
      cooldownUntil: inCooldown ? new Date(cooldownUntilMs).toISOString() : null,
      inCooldown,
      topCharge,
      ready: topCharge >= e.initiationThreshold,
      drives,
    };
  });
  res.json(states);
});

router.get("/engrams/:id", async (req, res) => {
  const parsed = GetEngramParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const engram = await loadEngram(parsed.data.id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  res.json(engram);
});

router.patch("/engrams/:id", async (req, res) => {
  const parsedParams = UpdateEngramConfigParams.safeParse({ id: req.params.id });
  const parsedBody = UpdateEngramConfigBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const engram = await loadEngram(parsedParams.data.id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (rejectIfArchival(engram, res)) return;

  const body = parsedBody.data;
  const patch: Partial<typeof engramsTable.$inferInsert> = { updatedAt: new Date() };
  if (body.autonomyEnabled !== undefined) patch.autonomyEnabled = body.autonomyEnabled;
  if (body.tickCadenceSeconds !== undefined)
    patch.tickCadenceSeconds = Math.round(Math.max(15, Math.min(3600, body.tickCadenceSeconds)));
  if (body.initiationThreshold !== undefined)
    patch.initiationThreshold = Math.max(0.1, Math.min(0.95, body.initiationThreshold));
  if (body.mode !== undefined) patch.mode = body.mode;
  if (body.humanContactEnabled !== undefined) patch.humanContactEnabled = body.humanContactEnabled;
  if (body.simulationEnabled !== undefined) patch.simulationEnabled = body.simulationEnabled;
  if (body.artifactGenerationEnabled !== undefined)
    patch.artifactGenerationEnabled = body.artifactGenerationEnabled;
  if (body.focusThemes !== undefined) patch.focusThemes = body.focusThemes;
  if (body.emotionalBaseline !== undefined) {
    patch.emotionalBaseline = body.emotionalBaseline;
    patch.currentMood = body.emotionalBaseline.mood;
  }
  if (body.drives !== undefined) patch.drives = body.drives;

  const [updated] = await db
    .update(engramsTable)
    .set(patch)
    .where(eq(engramsTable.id, engram.id))
    .returning();
  res.json(updated);
});

router.post("/engrams/:id/activate", async (req, res) => {
  const parsed = ActivateEngramParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const engram = await loadEngram(parsed.data.id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (rejectIfArchival(engram, res)) return;
  await db.update(engramsTable).set({ isChatActive: false }).where(and(eq(engramsTable.isChatActive, true), eq(engramsTable.ownerId, req.userId!)));
  const [updated] = await db
    .update(engramsTable)
    .set({ isChatActive: true, updatedAt: new Date() })
    .where(eq(engramsTable.id, engram.id))
    .returning();
  res.json(updated);
});

router.post("/engrams/:id/transmit", async (req, res) => {
  const parsed = TransmitEngramParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const engram = await loadEngram(parsed.data.id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (rejectIfArchival(engram, res)) return;
  try {
    const tx = await forceTransmission(engram);
    res.status(201).json(tx);
  } catch (err) {
    req.log.error({ err }, "engram transmission provider failed");
    res.status(503).json(llmProviderFailureResponse(err));
  }
});

router.get("/engrams/:id/transmissions", async (req, res) => {
  const parsed = ListEngramTransmissionsParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const engram = await loadEngram(parsed.data.id, req.userId!);
  if (!engram) return void res.status(404).json({ error: "Engram not found" });
  const rows = await db
    .select()
    .from(engramTransmissionsTable)
    .where(eq(engramTransmissionsTable.engramId, parsed.data.id))
    .orderBy(desc(engramTransmissionsTable.createdAt))
    .limit(TRANSMISSION_LIST_CAP);
  res.json(rows);
});

router.post("/engrams/:id/transmissions/mark-seen", async (req, res) => {
  const parsedParams = MarkTransmissionsSeenParams.safeParse({ id: req.params.id });
  const parsedBody = MarkTransmissionsSeenBody.safeParse(req.body ?? {});
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const { id } = parsedParams.data;
  const engram = await loadEngram(id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (rejectIfArchival(engram, res)) return;
  const ids = parsedBody.data.ids;
  const filter =
    ids && ids.length > 0
      ? and(eq(engramTransmissionsTable.engramId, id), inArray(engramTransmissionsTable.id, ids))
      : and(eq(engramTransmissionsTable.engramId, id), eq(engramTransmissionsTable.seen, false));

  const marked = await db
    .update(engramTransmissionsTable)
    .set({ seen: true })
    .where(filter)
    .returning({ id: engramTransmissionsTable.id });
  res.json({ marked: marked.length });
});

router.get("/engrams/:id/inquiries", async (req, res) => {
  const parsed = ListEngramInquiriesParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const engram = await loadEngram(parsed.data.id, req.userId!);
  if (!engram) return void res.status(404).json({ error: "Engram not found" });
  const rows = await db
    .select()
    .from(engramInquiriesTable)
    .where(eq(engramInquiriesTable.engramId, parsed.data.id))
    .orderBy(desc(engramInquiriesTable.createdAt));
  res.json(rows);
});

router.post("/engrams/:id/inquiries", async (req, res) => {
  const parsedParams = CreateEngramInquiryParams.safeParse({ id: req.params.id });
  const parsedBody = CreateEngramInquiryBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const engram = await loadEngram(parsedParams.data.id, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  const { kind, question } = parsedBody.data;
  if (rejectIfArchival(engram, res)) return;

  try {
    if (kind === "probe") {
      const response = await generateProbeResponse({
        engram,
        question,
        responseLanguageInstruction: responseLanguageInstruction(parsedBody.data.language),
      });
      const [row] = await db
        .insert(engramInquiriesTable)
        .values({ engramId: engram.id, kind, question, response, configDelta: null })
        .returning();
      res.status(201).json(row);
      return;
    }

    // develop: tune the engram within bounded fields.
    const { response, delta } = await generateDevelopment({
      engram,
      question,
      responseLanguageInstruction: responseLanguageInstruction(parsedBody.data.language),
    });

    const patch: Partial<typeof engramsTable.$inferInsert> = { updatedAt: new Date() };
    if (delta.emotionalBaseline) {
      const merged: EmotionalBaseline = { ...engram.emotionalBaseline, ...delta.emotionalBaseline };
      patch.emotionalBaseline = merged;
      if (delta.emotionalBaseline.mood) patch.currentMood = delta.emotionalBaseline.mood;
    }
    if (delta.focusThemes) patch.focusThemes = delta.focusThemes;
    if (delta.driveWeights) {
      patch.drives = engram.drives.map((d) =>
        delta.driveWeights && d.id in delta.driveWeights
          ? { ...d, weight: delta.driveWeights[d.id] }
          : d,
      );
    }
    if (delta.addFacts && delta.addFacts.length > 0) {
      const facts = [...engram.memorySeed.facts];
      for (const f of delta.addFacts) {
        if (!facts.includes(f)) facts.push(f);
      }
      patch.memorySeed = { ...engram.memorySeed, facts: facts.slice(-MAX_FACTS) };
    }
    if (delta.initiationThreshold !== undefined) patch.initiationThreshold = delta.initiationThreshold;
    if (delta.tickCadenceSeconds !== undefined) patch.tickCadenceSeconds = delta.tickCadenceSeconds;

    if (Object.keys(patch).length > 1) {
      await db.update(engramsTable).set(patch).where(eq(engramsTable.id, engram.id));
    }

    const [row] = await db
      .insert(engramInquiriesTable)
      .values({
        engramId: engram.id,
        kind,
        question,
        response,
        configDelta: delta as Record<string, unknown>,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error(err);
    res.status(503).json({ error: "Generation unavailable" });
  }
});

export default router;
