import { Router } from "express";
import { db } from "@workspace/db";
import { journalTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateJournalEntryBody } from "@workspace/api-zod";

const router = Router();

router.get("/journal", async (req, res) => {
  const rows = await db
    .select()
    .from(journalTable)
    .where(eq(journalTable.ownerId, req.userId!))
    .orderBy(journalTable.createdAt);
  res.json(rows.map(r => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  })));
});

router.post("/journal", async (req, res) => {
  const parsed = CreateJournalEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const inserted = await db
    .insert(journalTable)
    .values({ ...parsed.data, ownerId: req.userId! })
    .returning();
  const row = inserted[0];
  res.status(201).json({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
});

export default router;
