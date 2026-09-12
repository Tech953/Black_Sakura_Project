import { Router } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "@workspace/db";
import { mobilePushTokensTable } from "@workspace/db/schema";
import {
  RegisterPushTokenBody,
  UnregisterPushTokenBody,
} from "@workspace/api-zod";

const router = Router();

router.post("/mobile/push-tokens", async (req, res) => {
  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const now = new Date();
  await db
    .insert(mobilePushTokensTable)
    .values({
      ownerId: req.userId!,
      token: parsed.data.token,
      platform: parsed.data.platform,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: mobilePushTokensTable.token,
      set: {
        ownerId: req.userId!,
        platform: parsed.data.platform,
        updatedAt: now,
      },
    });
  res.status(204).send();
});

router.delete("/mobile/push-tokens", async (req, res) => {
  const parsed = UnregisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db
    .delete(mobilePushTokensTable)
    .where(
      and(
        eq(mobilePushTokensTable.ownerId, req.userId!),
        eq(mobilePushTokensTable.token, parsed.data.token),
      ),
    );
  res.status(204).send();
});

export default router;