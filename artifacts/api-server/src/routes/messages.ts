import { Router } from "express";
import type { EngramMessage, EngramMessageChannel } from "@workspace/db";
import {
  ListEngramMessagesQueryParams,
  MarkEngramMessagesSeenBody,
  ReplyToEngramMessageBody,
  ReplyToEngramMessageParams,
} from "@workspace/api-zod";
import { loadMessages, markMessagesSeen, replyToMessage } from "../lib/messages-store";

const router = Router();

function serializeMessage(m: EngramMessage) {
  return {
    id: m.id,
    fromEngramId: m.fromEngramId,
    toEngramId: m.toEngramId ?? null,
    spaceId: m.spaceId ?? null,
    channel: m.channel,
    author: m.author,
    priority: m.priority,
    status: m.status,
    content: m.content,
    reason: m.reason ?? null,
    seen: m.seen,
    isDigest: m.isDigest,
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

router.post("/messages/:id/reply", async (req, res) => {
  const parsedParams = ReplyToEngramMessageParams.safeParse({ id: req.params.id });
  const parsedBody = ReplyToEngramMessageBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid reply" });
    return;
  }
  const content = parsedBody.data.content.trim();
  if (!content) {
    res.status(400).json({ error: "Reply cannot be blank" });
    return;
  }

  const reply = await replyToMessage(
    req.userId!,
    parsedParams.data.id,
    content,
  );
  if (!reply) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  res.status(201).json(serializeMessage(reply));
});

export default router;
