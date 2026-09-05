import { Router } from "express";
import { db } from "@workspace/db";
import { personasTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { SetActivePersonaBody } from "@workspace/api-zod";

const router = Router();

router.get("/personas", async (req, res) => {
  const rows = await db
    .select()
    .from(personasTable)
    .where(eq(personasTable.ownerId, req.userId!))
    .orderBy(personasTable.id);
  res.json(rows);
});

router.patch("/personas/active", async (req, res) => {
  const parsed = SetActivePersonaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const personaId = parsed.data.personaId;
  const ownerId = req.userId!;
  const [persona] = await db
    .select()
    .from(personasTable)
    .where(and(eq(personasTable.id, personaId), eq(personasTable.ownerId, ownerId)))
    .limit(1);
  if (!persona) {
    res.status(404).json({ error: "Persona not found" });
    return;
  }
  const updated = await db.transaction(async (tx) => {
    await tx.update(personasTable)
      .set({ isActive: false })
      .where(eq(personasTable.ownerId, ownerId));
    return tx.update(personasTable)
      .set({ isActive: true })
      .where(and(eq(personasTable.id, personaId), eq(personasTable.ownerId, ownerId)))
      .returning();
  });
  res.json(updated[0]);
});

export default router;
