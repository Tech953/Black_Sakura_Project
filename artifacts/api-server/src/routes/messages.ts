import { Router } from "express";
import type { EngramMessage, EngramMessageChannel } from "@workspace/db";
import {
  ListEngramMessagesQueryParams,
  MarkEngramMessagesSeenBody,
} from "@workspace/api-zod";
import { loadMessages, markMessagesSeen } from "../lib/messages-store";

const router = Router();

function serializeMessage(m: EngramMessage) {
  return {
    id: m.id,
    fromEngramId: m.fromEngramId,
    toEngramId: m.toEngramId ?? null,
    spaceId: m.spaceId ?? null,
    channel: m.channel,
    priority: m.priority,
    status: m.status,
    content: m.content,
    reason: m.reason ?? null,
    seen: m.seen,
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/messages", async (req, res) => {
  const parsed = ListEngramMessagesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const rows = await loadMessages(req.userId!, {
    channel: parsed.data.channel as EngramMessageChannel | undefined,
    limit: parsed.data.limit,
  });
  res.json(rows.map(serializeMessage));
});

router.post("/messages/mark-seen", async (req, res) => {
  const parsed = MarkEngramMessagesSeenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updated = await markMessagesSeen(req.userId!, parsed.data.ids);
  res.json({ updated });
});

export default router;
