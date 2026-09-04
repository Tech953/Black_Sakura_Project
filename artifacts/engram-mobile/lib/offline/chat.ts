import type { Engram } from "@workspace/db";
import { buildEngramSystemPrompt, summarizeWorldModel } from "@workspace/engram-core";
import { responseLanguageInstruction } from "@workspace/i18n";

import { completeStream, type ChatMessage } from "./llm";
import { assertOfflineInput } from "./limits";
import * as store from "./store";
import { resolveReplyLanguage } from "../i18n";

/**
 * On-device chat turn: mirrors the server's engram-linked chat route —
 * same system prompt (via @workspace/engram-core), history replay, an OBSERVED
 * world-model write for what the user said, and persisted messages.
 */
export async function sendOfflineMessage(opts: {
  conversationId: number;
  engramId: number;
  content: string;
  onToken: (delta: string) => void;
}): Promise<string> {
  const { conversationId, engramId, content, onToken } = opts;
  assertOfflineInput(content);

  const persona = await store.getEngramPersona(engramId);
  if (!persona) throw new Error("Engram not found");
  const engram = persona as unknown as Engram;

  const worldModelSummary = summarizeWorldModel(await store.loadRecentWorldModel(engramId));
  const systemPrompt = buildEngramSystemPrompt({
    engram,
    situation:
      "You are in a live, ongoing conversation with them right now — running fully on their handheld device, no network. Respond to their latest message in character, staying in your formatting conventions.",
    worldModelSummary,
    responseLanguageInstruction: responseLanguageInstruction(await resolveReplyLanguage()),
  });

  const history = await store.listMessages(conversationId);
  await store.appendMessage(conversationId, "user", content);

  // Small on-device context: keep the most recent exchanges.
  const recent = history.slice(-16);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recent.map((mIn) => ({
      role: (mIn.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: mIn.content,
    })),
    { role: "user", content },
  ];

  try {
    const full = await completeStream(messages, onToken, { maxTokens: 384 });
    await store.appendMessage(conversationId, "assistant", full);
    // Mirror the server only after a successful turn, so failed turns do not
    // become durable observations.
    await store
      .appendObservedEntry({
        engramId,
        content: `They said: "${content.replace(/\s+/g, " ").trim().slice(0, 240)}"`,
        confidence: 0.85,
        source: `chat:${conversationId}`,
      })
      .catch(() => {});
    return full;
  } catch (error) {
    await store.removeLastMessage(conversationId, "user", content).catch(() => {});
    throw error;
  }
}
