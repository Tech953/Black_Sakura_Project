import { db } from "@workspace/db";
import { conversations, messages } from "@workspace/db/schema";
import type { Engram, EngramMessage, Message } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { attemptHumanContact } from "./human-contact";
import type { Capabilities } from "./engram-policy";
import { publishEvent } from "./events";

/**
 * Where an engram-initiated contact attempt should land.
 * - `busOnly`   — record on the human-contact bus only (the legacy behavior): an
 *   audit row + the terminal's notification queue, nothing visible in chat.
 * - `chatConversation` — additionally mirror the contact into the engram's own chat
 *   thread so the operator sees the engram speak up live (self-initiated chat).
 */
export type ContactTarget = "busOnly" | "chatConversation";

export interface OperatorContactOutcome {
  /** The human-contact bus row (always written, including refusals). */
  message: EngramMessage;
  /** True only for an immediate (urgent) delivery — mirrors the bus decision. */
  delivered: boolean;
  /** The conversation the message was posted into, when target was chat + allowed. */
  conversationId: number | null;
  /** The chat message row created in that conversation, when posted. */
  chatMessage: Message | null;
  /** True when the contact was actually posted into a chat thread. */
  posted: boolean;
}

/**
 * Find (or lazily open) the canonical chat thread an engram uses to reach the
 * operator. There is one per engram: the most-recent engram-linked conversation is
 * reused so self-initiated posts land in the same thread the operator already chats
 * in; if the engram has none, a dedicated "direct line" thread is created. The
 * thread carries `engramId` so the existing chat route answers in that engram's
 * persona on any follow-up.
 */
export async function ensureEngramConversation(engram: Engram, ownerId: string): Promise<{ id: number }> {
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.engramId, engram.id), eq(conversations.ownerId, ownerId)))
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(conversations)
    .values({
      ownerId,
      title: `${engram.name} — direct line`,
      mode: "companion",
      engramId: engram.id,
    })
    .returning({ id: conversations.id });
  return created;
}

/**
 * Route one engram-initiated contact attempt through the bounded human-contact bus
 * and, for `chatConversation` targets, mirror it into the engram's canonical chat
 * thread. The bus (policy + caps + audit) is the single source of truth for WHETHER
 * the engram may reach the operator at all — the chat mirror only happens when the
 * bus did NOT block the attempt, so a refused/blocked contact never leaks into chat.
 *
 * Events are published AFTER the inserts commit so a client that reacts by refetching
 * always sees the persisted message. `chat.self_initiated` is the high-level "the
 * engram spoke up" nudge; `message.created` mirrors the exact shape the normal chat
 * route emits, so the chat UI appends/refetches identically for both.
 */
export async function attemptOperatorContact(opts: {
  ownerId: string;
  engram: Engram;
  capabilities: Capabilities;
  charge: number;
  content: string;
  target: ContactTarget;
  now?: Date;
}): Promise<OperatorContactOutcome> {
  const { ownerId, engram, capabilities, charge, content, target } = opts;
  const now = opts.now ?? new Date();

  const { message, delivered } = await attemptHumanContact({
    ownerId,
    engram,
    capabilities,
    charge,
    content,
    now,
  });

  let conversationId: number | null = null;
  let chatMessage: Message | null = null;

  if (target === "chatConversation" && message.status !== "blocked") {
    const conv = await ensureEngramConversation(engram, ownerId);
    const [row] = await db
      .insert(messages)
      .values({ conversationId: conv.id, role: "assistant", content })
      .returning();
    conversationId = conv.id;
    chatMessage = row;

    publishEvent({
      type: "chat.self_initiated",
      ownerId,
      engramId: engram.id,
      conversationId: conv.id,
      data: {
        messageId: row.id,
        status: message.status,
        priority: message.priority,
        engramName: engram.name,
      },
    });
    publishEvent({
      type: "message.created",
      ownerId,
      engramId: engram.id,
      conversationId: conv.id,
      data: row,
    });
  }

  return {
    message,
    delivered,
    conversationId,
    chatMessage,
    posted: chatMessage != null,
  };
}
