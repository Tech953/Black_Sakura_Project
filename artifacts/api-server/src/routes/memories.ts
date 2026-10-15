import { Router } from "express";
import { db } from "@workspace/db";
import { memoriesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateMemoryBody, ListMemoriesQueryParams, DeleteMemoryParams } from "@workspace/api-zod";

const router = Router();

router.get("/memories", async (req, res) => {
  const parsed = ListMemoriesQueryParams.safeParse(req.query);
  const layer = parsed.success ? parsed.data.layer : undefined;

  let rows;
  if (layer) {
    rows = await db.select().from(memoriesTable).where(and(eq(memoriesTable.ownerId, req.userId!), eq(memoriesTable.layer, layer))).orderBy(memoriesTable.createdAt);
  } else {
    rows = await db.select().from(memoriesTable).where(eq(memoriesTable.ownerId, req.userId!)).orderBy(memoriesTable.createdAt);
  }
  res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    lastAccessed: r.lastAccessed ? r.lastAccessed.toISOString() : null,
  })));
});

router.post("/memories", async (req, res) => {
  const parsed = CreateMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const inserted = await db.insert(memoriesTable).values({ ...parsed.data, ownerId: req.userId! }).returning();
  const row = inserted[0];
  res.status(201).json({
    ...row,
    createdAt: row.createdAt.toISOString(),
    lastAccessed: row.lastAccessed ? row.lastAccessed.toISOString() : null,
  });
});

router.delete("/memories/:id", async (req, res) => {
  const parsed = DeleteMemoryParams.safeParse({ id: parseInt(req.params.id) });
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const deleted = await db.delete(memoriesTable).where(and(eq(memoriesTable.id, parsed.data.id), eq(memoriesTable.ownerId, req.userId!))).returning({ id: memoriesTable.id });
  if (!deleted.length) {
    res.status(404).json({ error: "Memory not found" });
    return;
  }
  res.status(204).send();
});

export default router;
