import { Router } from "express";
import { db } from "@workspace/db";
import { initiativeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateInitiativeEventBody } from "@workspace/api-zod";

const router = Router();

router.get("/initiative", async (req, res) => {
  const rows = await db.select().from(initiativeTable).where(eq(initiativeTable.ownerId, req.userId!)).orderBy(initiativeTable.createdAt);
  res.json(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

router.post("/initiative", async (req, res) => {
  const parsed = CreateInitiativeEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const inserted = await db.insert(initiativeTable).values({ ...parsed.data, ownerId: req.userId! }).returning();
  const row = inserted[0];
  res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
});

export default router;
