import { Router } from "express";
import { db } from "@workspace/db";
import { hieroTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/hiero-code", async (req, res) => {
  const rows = await db.select().from(hieroTable).where(eq(hieroTable.ownerId, req.userId!)).orderBy(hieroTable.id);
  res.json(rows);
});

export default router;
