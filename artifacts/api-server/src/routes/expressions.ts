import { Router } from "express";
import { db } from "@workspace/db";
import { expressionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/expressions", async (req, res) => {
  const rows = await db.select().from(expressionsTable).where(eq(expressionsTable.ownerId, req.userId!)).orderBy(expressionsTable.id);
  res.json(rows);
});

export default router;
