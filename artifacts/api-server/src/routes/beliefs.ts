import { Router } from "express";
import { db } from "@workspace/db";
import { beliefsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateBeliefBody, UpdateBeliefBody, UpdateBeliefParams, DeleteBeliefParams } from "@workspace/api-zod";

const router = Router();

router.get("/beliefs", async (req, res) => {
  const rows = await db.select().from(beliefsTable).where(eq(beliefsTable.ownerId, req.userId!)).orderBy(beliefsTable.createdAt);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/beliefs", async (req, res) => {
  const parsed = CreateBeliefBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  const inserted = await db.insert(beliefsTable).values({
    ownerId: req.userId!,
    ...parsed.data,
    lastReviewed: today,
  }).returning();
  const row = inserted[0];
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

router.patch("/beliefs/:id", async (req, res) => {
  const paramsParsed = UpdateBeliefParams.safeParse({ id: parseInt(req.params.id) });
  if (!paramsParsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const bodyParsed = UpdateBeliefBody.safeParse(req.body);
  if (!bodyParsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const today = new Date().toISOString().split("T")[0];
  const existing = await db.select().from(beliefsTable).where(and(eq(beliefsTable.id, paramsParsed.data.id), eq(beliefsTable.ownerId, req.userId!))).limit(1);
  if (!existing[0]) {
    res.status(404).json({ error: "Belief not found" });
    return;
  }
  const updated = await db.update(beliefsTable)
    .set({ ...bodyParsed.data, lastReviewed: today, revisionCount: existing[0].revisionCount + 1 })
    .where(and(eq(beliefsTable.id, paramsParsed.data.id), eq(beliefsTable.ownerId, req.userId!)))
    .returning();
  res.json({ ...updated[0], createdAt: updated[0].createdAt.toISOString() });
});

router.delete("/beliefs/:id", async (req, res) => {
  const parsed = DeleteBeliefParams.safeParse({ id: parseInt(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db
    .delete(beliefsTable)
    .where(and(eq(beliefsTable.id, parsed.data.id), eq(beliefsTable.ownerId, req.userId!)))
    .returning({ id: beliefsTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Belief not found" });
    return;
  }
  res.status(204).send();
});

export default router;
