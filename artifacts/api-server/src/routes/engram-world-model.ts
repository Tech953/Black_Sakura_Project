import { Router } from "express";
import { db } from "@workspace/db";
import { engramsTable, engramWorldModelTable } from "@workspace/db/schema";
import type { EngramWorldModelEntry } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import {
  ListEngramWorldModelParams,
  CreateEngramWorldModelEntryParams,
  CreateEngramWorldModelEntryBody,
  UpdateEngramWorldModelEntryParams,
  UpdateEngramWorldModelEntryBody,
  DeleteEngramWorldModelEntryParams,
} from "@workspace/api-zod";
import {
  applyWorldModelPatch,
  clampConfidence,
  ProvenanceImmutableError,
} from "../lib/world-model";
import { isArchivalEngram, ARCHIVAL_READ_ONLY_ERROR } from "../lib/archival";

const router = Router();

const WORLD_MODEL_LIST_CAP = 200;
const DEFAULT_CONFIDENCE = 0.7;

async function engramExists(id: number): Promise<boolean> {
  const [row] = await db
    .select({ id: engramsTable.id })
    .from(engramsTable)
    .where(eq(engramsTable.id, id));
  return Boolean(row);
}

async function loadEntry(
  engramId: number,
  entryId: number,
): Promise<EngramWorldModelEntry | undefined> {
  const [row] = await db
    .select()
    .from(engramWorldModelTable)
    .where(
      and(
        eq(engramWorldModelTable.id, entryId),
        eq(engramWorldModelTable.engramId, engramId),
      ),
    );
  return row;
}

function serialize(row: EngramWorldModelEntry) {
  return {
    id: row.id,
    engramId: row.engramId,
    provenance: row.provenance,
    content: row.content,
    confidence: row.confidence,
    scope: row.scope,
    source: row.source ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.get("/engrams/:id/world-model", async (req, res) => {
  const parsed = ListEngramWorldModelParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await engramExists(parsed.data.id))) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  const rows = await db
    .select()
    .from(engramWorldModelTable)
    .where(eq(engramWorldModelTable.engramId, parsed.data.id))
    .orderBy(desc(engramWorldModelTable.createdAt))
    .limit(WORLD_MODEL_LIST_CAP);
  res.json(rows.map(serialize));
});

router.post("/engrams/:id/world-model", async (req, res) => {
  const parsedParams = CreateEngramWorldModelEntryParams.safeParse({ id: req.params.id });
  const parsedBody = CreateEngramWorldModelEntryBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  if (!(await engramExists(parsedParams.data.id))) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (await isArchivalEngram(parsedParams.data.id)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const body = parsedBody.data;
  const [row] = await db
    .insert(engramWorldModelTable)
    .values({
      engramId: parsedParams.data.id,
      provenance: body.provenance,
      content: body.content,
      confidence: body.confidence !== undefined ? clampConfidence(body.confidence) : DEFAULT_CONFIDENCE,
      scope: body.scope ?? "private",
      source: body.source ?? null,
    })
    .returning();
  res.status(201).json(serialize(row));
});

router.patch("/engrams/:id/world-model/:entryId", async (req, res) => {
  const parsedParams = UpdateEngramWorldModelEntryParams.safeParse({
    id: req.params.id,
    entryId: req.params.entryId,
  });
  const parsedBody = UpdateEngramWorldModelEntryBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const existing = await loadEntry(parsedParams.data.id, parsedParams.data.entryId);
  if (!existing) {
    res.status(404).json({ error: "World-model entry not found" });
    return;
  }
  if (await isArchivalEngram(parsedParams.data.id)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }

  let merged;
  try {
    // Pass through any raw `provenance` so an attempt to relabel is rejected, not ignored.
    merged = applyWorldModelPatch(
      {
        provenance: existing.provenance,
        content: existing.content,
        confidence: existing.confidence,
        scope: existing.scope,
        source: existing.source,
      },
      { ...parsedBody.data, provenance: (req.body as Record<string, unknown> | undefined)?.provenance },
    );
  } catch (err) {
    if (err instanceof ProvenanceImmutableError) {
      res.status(409).json({ error: err.message });
      return;
    }
    throw err;
  }

  const [row] = await db
    .update(engramWorldModelTable)
    .set({ ...merged, updatedAt: new Date() })
    .where(eq(engramWorldModelTable.id, existing.id))
    .returning();
  res.json(serialize(row));
});

router.delete("/engrams/:id/world-model/:entryId", async (req, res) => {
  const parsed = DeleteEngramWorldModelEntryParams.safeParse({
    id: req.params.id,
    entryId: req.params.entryId,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await loadEntry(parsed.data.id, parsed.data.entryId);
  if (!existing) {
    res.status(404).json({ error: "World-model entry not found" });
    return;
  }
  if (await isArchivalEngram(parsed.data.id)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  await db.delete(engramWorldModelTable).where(eq(engramWorldModelTable.id, existing.id));
  res.status(204).send();
});

export default router;
