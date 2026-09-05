import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Run against a REAL embedded Postgres (in-memory PGlite) so the actual conversation
// find-or-create + message insert + bus write are exercised end-to-end. The driver
// seam reads ENGRAM_DB_DRIVER at import time, so it must be set before the module
// graph loads — vi.hoisted runs ahead of imports.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  db,
  ensureDatabaseReady,
  closeDb,
  engramsTable,
  engramMessagesTable,
  conversations,
  messages,
  type Engram,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { attemptOperatorContact } from "./operator-contact";
import { subscribe, type EngramEvent } from "./events";
import type { Capabilities } from "./engram-policy";

const ready = ensureDatabaseReady({ seed: false });

const OPEN_CAPS: Capabilities = {
  canIdle: true,
  canConverse: true,
  canContactHuman: true,
  canSimulate: false,
  canGenerateArtifacts: false,
  canMirrorHumanContactToChat: true,
  minHumanPriority: "social",
};

const NO_HUMAN_CAPS: Capabilities = {
  canIdle: true,
  canConverse: true,
  canContactHuman: false,
  canSimulate: false,
  canGenerateArtifacts: false,
  canMirrorHumanContactToChat: false,
  minHumanPriority: "urgent",
  humanContactBlockReason: "test: human contact disabled",
};

beforeEach(async () => {
  await ready;
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramMessagesTable);
  await db.delete(engramsTable);
});

afterAll(async () => {
  await closeDb();
});

let seq = 0;
async function insertEngram(): Promise<Engram> {
  seq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      slug: `contact-engram-${seq}`,
      name: `Contact Engram ${seq}`,
      title: "Reacher",
      symbol: "R",
      origin: "test",
      voiceProfile: {
        speechStyle: "",
        formatting: "",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "" },
      environmentAnchor: { name: "", description: "", locations: [], items: [], ambient: "" },
      memorySeed: { relationship: "", facts: [], summary: "" },
      guardrails: { framing: "", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning();
  return row;
}

describe("attemptOperatorContact — self-initiated chat", () => {
  it("chatConversation target posts an assistant message AND a bus row, and emits both events", async () => {
    const engram = await insertEngram();

    const seen: EngramEvent[] = [];
    const unsubscribe = subscribe({ engramId: engram.id }, (e) => seen.push(e));

    const outcome = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities: OPEN_CAPS,
      charge: 0.95, // urgent -> delivered
      content: "I noticed the lattice went quiet. Are you still there?",
      target: "chatConversation",
    });
    unsubscribe();

    expect(outcome.delivered).toBe(true);
    expect(outcome.posted).toBe(true);
    expect(outcome.conversationId).not.toBeNull();
    expect(outcome.chatMessage?.role).toBe("assistant");

    // A chat message landed in a NEW engram-linked conversation.
    const conv = (
      await db.select().from(conversations).where(eq(conversations.id, outcome.conversationId!))
    )[0];
    expect(conv?.engramId).toBe(engram.id);
    const chatMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, outcome.conversationId!));
    expect(chatMsgs).toHaveLength(1);
    expect(chatMsgs[0].content).toContain("lattice went quiet");

    // The human-contact bus also recorded the attempt (audit + notification).
    const bus = await db
      .select()
      .from(engramMessagesTable)
      .where(eq(engramMessagesTable.fromEngramId, engram.id));
    expect(bus).toHaveLength(1);
    expect(bus[0].channel).toBe("human");
    expect(bus[0].status).toBe("delivered");

    // Both live-push events fired, scoped to this engram + conversation.
    const types = seen.map((e) => e.type);
    expect(types).toContain("chat.self_initiated");
    expect(types).toContain("message.created");
    for (const e of seen) {
      expect(e.conversationId).toBe(outcome.conversationId);
      expect(e.engramId).toBe(engram.id);
    }
  });

  it("busOnly target records the bus row but posts NOTHING to chat", async () => {
    const engram = await insertEngram();

    const seen: EngramEvent[] = [];
    const unsubscribe = subscribe({ engramId: engram.id }, (e) => seen.push(e));

    const outcome = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities: OPEN_CAPS,
      charge: 0.95,
      content: "Bus-only ping.",
      target: "busOnly",
    });
    unsubscribe();

    expect(outcome.posted).toBe(false);
    expect(outcome.conversationId).toBeNull();
    expect(outcome.chatMessage).toBeNull();

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(0);
    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(0);
    expect(seen).toHaveLength(0);

    const bus = await db.select().from(engramMessagesTable);
    expect(bus).toHaveLength(1);
  });

  it("a BLOCKED contact never leaks into chat even with the chat target", async () => {
    const engram = await insertEngram();

    const outcome = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities: NO_HUMAN_CAPS, // canContactHuman=false -> blocked
      charge: 0.95,
      content: "This should never appear in chat.",
      target: "chatConversation",
    });

    expect(outcome.posted).toBe(false);
    expect(outcome.message.status).toBe("blocked");

    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(0);
    const msgs = await db.select().from(messages);
    expect(msgs).toHaveLength(0);

    // The refusal is still audited on the bus.
    const bus = await db.select().from(engramMessagesTable);
    expect(bus).toHaveLength(1);
    expect(bus[0].status).toBe("blocked");
  });

  it("reuses the engram's existing conversation instead of opening a second one", async () => {
    const engram = await insertEngram();

    const first = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities: OPEN_CAPS,
      charge: 0.95,
      content: "First self-initiated note.",
      target: "chatConversation",
    });
    const second = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities: OPEN_CAPS,
      charge: 0.95,
      content: "Second self-initiated note.",
      target: "chatConversation",
    });

    expect(second.conversationId).toBe(first.conversationId);
    const convs = await db.select().from(conversations);
    expect(convs).toHaveLength(1);
    const msgs = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, first.conversationId!));
    expect(msgs).toHaveLength(2);
  });
});
