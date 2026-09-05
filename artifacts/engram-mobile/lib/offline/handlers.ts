import type { Engram } from "@workspace/db";
import { buildEngramSystemPrompt, summarizeWorldModel } from "@workspace/engram-core";
import { responseLanguageInstruction } from "@workspace/i18n";
import type { LocalHandler } from "@workspace/api-client-react";

import { completeOnce } from "./llm";
import { assertOfflineInput } from "./limits";
import * as store from "./store";
import { resolveReplyLanguage } from "../i18n";

/**
 * Local (on-device) implementations of every REST endpoint the app calls
 * through the generated hooks. Registered via setLocalHandler when offline
 * mode is active. Chat streaming is handled separately (lib/offline/chat.ts).
 *
 * Prompt construction goes through @workspace/engram-core — the SAME persona
 * prompts and hard safety constraints the server uses.
 */
function ok(body: unknown, status = 200): { status: number; body: unknown } {
  return { status, body };
}

function notFound(msg: string): { status: number; body: unknown } {
  return { status: 404, body: { error: msg } };
}

function archivalReadOnly(): { status: number; body: unknown } {
  return {
    status: 403,
    body: { error: store.OFFLINE_ARCHIVAL_READ_ONLY_ERROR },
  };
}

async function personaAsEngram(id: number): Promise<Engram | null> {
  const persona = await store.getEngramPersona(id);
  return persona ? (persona as unknown as Engram) : null;
}

async function handleInquiry(
  engramId: number,
  body: {
    kind: "probe" | "develop";
    question: string;
    language?: string;
  },
): Promise<{ status: number; body: unknown }> {
  const kind = body.kind;
  const question = body.question.trim();
  if (!question) return { status: 400, body: { error: "Question required" } };
  try {
    assertOfflineInput(question);
  } catch {
    return { status: 413, body: { error: "Question is too long for offline mode." } };
  }
  const engram = await personaAsEngram(engramId);
  if (!engram) return notFound("Engram not found");
  if (engram.isArchival) return archivalReadOnly();

  // Mirrors the server's probe prompt. Offline "develop" answers in character
  // but applies no config delta (tuning requires the server's bounded pipeline).
  const situation =
    kind === "probe"
      ? "Your designer is introspecting you through the inquiry system. Answer their question about yourself honestly and in-character — reflective and self-aware about being a construct, but unmistakably you. Do not change yourself; just reveal yourself."
      : "Your designer is speaking with you through the inquiry system while you run on their handheld device in offline mode. Respond to their request in character. In this offline mode you cannot actually alter your own configuration — acknowledge their wish and respond honestly, but you remain as you are until reconnected.";
  const system = buildEngramSystemPrompt({
    engram,
    situation,
    responseLanguageInstruction: responseLanguageInstruction(
      body.language ?? (await resolveReplyLanguage()),
    ),
  });
  const response = await completeOnce(
    [
      { role: "system", content: system },
      { role: "user", content: question },
    ],
    { maxTokens: 384 },
  );
  const row = await store.insertInquiry({ engramId, kind, question, response });
  return ok(row, 201);
}

async function handleTransmit(engramId: number): Promise<{ status: number; body: unknown }> {
  const engram = await personaAsEngram(engramId);
  if (!engram) return notFound("Engram not found");
  if (engram.isArchival) return archivalReadOnly();

  const drives = engram.drives ?? [];
  const drive = drives.length
    ? drives[Math.floor(Math.random() * drives.length)]
    : { id: "presence", label: "Presence", description: "the wish to be present" };
  const recent = (await store.listTransmissions(engramId))
    .slice(0, 5)
    .map((t) => String(t.content));
  const avoid = recent.length
    ? `\n\nYou recently expressed the following — do NOT repeat their content or phrasing:\n${recent
        .map((c) => `  - ${c.replace(/\s+/g, " ").slice(0, 160)}`)
        .join("\n")}`
    : "";
  const worldModelSummary = summarizeWorldModel(await store.loadRecentWorldModel(engramId));
  const situation = `No prompt has come in, but your drive "${drive.label}" (${drive.description}) has built up enough that you decide, on your own, to reach out. Send a short, in-character message directed at them — unprompted contact. You may open a topic, share something on your mind, or ASK THEM A DIRECT QUESTION you genuinely want answered. 2–4 sentences. Use your formatting conventions.${avoid}`;
  const system = buildEngramSystemPrompt({
    engram,
    situation,
    worldModelSummary,
    responseLanguageInstruction: responseLanguageInstruction(await resolveReplyLanguage()),
  });
  const content = await completeOnce(
    [
      { role: "system", content: system },
      { role: "user", content: "Reach out now, unprompted, in your own voice." },
    ],
    { maxTokens: 384 },
  );
  const row = await store.insertTransmission({
    engramId,
    kind: "outreach",
    drive: drive.id,
    content,
    mood: engram.currentMood ?? null,
  });
  return ok(row, 201);
}

/** Route table for offline mode. Returns undefined only for truly unknown paths. */
export const offlineHandler: LocalHandler = async ({ method, path, body }) => {
  const url = path.split("?")[0];
  let parsed: Record<string, unknown> = {};
  if (body) {
    try {
      const value = JSON.parse(body) as unknown;
      if (
        value === null ||
        typeof value !== "object" ||
        Array.isArray(value)
      ) {
        return { status: 400, body: { error: "Invalid JSON body" } };
      }
      parsed = value as Record<string, unknown>;
    } catch {
      return { status: 400, body: { error: "Invalid JSON body" } };
    }
  }

  if (url === "/api/healthz") return ok({ status: "ok" });

  let m: RegExpMatchArray | null;

  if (url === "/api/engrams" && method === "GET") return ok(await store.listEngrams());

  if ((m = url.match(/^\/api\/engrams\/(\d+)$/)) && method === "GET") {
    const engram = await store.getEngram(Number(m[1]));
    return engram ? ok(engram) : notFound("Engram not found");
  }

  if ((m = url.match(/^\/api\/engrams\/(\d+)\/activate$/)) && method === "POST") {
    const engramId = Number(m[1]);
    const existing = await store.getEngram(engramId);
    if (!existing) return notFound("Engram not found");
    if (existing.isArchival === true) return archivalReadOnly();
    const engram = await store.activateEngram(engramId);
    return engram ? ok(engram) : notFound("Engram not found");
  }

  if ((m = url.match(/^\/api\/engrams\/(\d+)\/inquiries$/))) {
    if (method === "GET") return ok(await store.listInquiries(Number(m[1])));
    if (method === "POST") {
      const inquiry = parsed as {
        kind?: unknown;
        question?: unknown;
        language?: unknown;
      };
      if (
        (inquiry.kind !== "probe" && inquiry.kind !== "develop") ||
        typeof inquiry.question !== "string" ||
        (inquiry.language !== undefined &&
          typeof inquiry.language !== "string")
      ) {
        return { status: 400, body: { error: "Invalid inquiry body" } };
      }
      return handleInquiry(Number(m[1]), {
        kind: inquiry.kind,
        question: inquiry.question,
        language: inquiry.language as string | undefined,
      });
    }
  }

  if ((m = url.match(/^\/api\/engrams\/(\d+)\/transmissions$/)) && method === "GET") {
    return ok(await store.listTransmissions(Number(m[1])));
  }

  if ((m = url.match(/^\/api\/engrams\/(\d+)\/transmissions\/mark-seen$/)) && method === "POST") {
    const candidateIds = (parsed as { ids?: unknown }).ids;
    if (
      candidateIds !== undefined &&
      (!Array.isArray(candidateIds) ||
        candidateIds.some(
          (id) => typeof id !== "number" || !Number.isFinite(id),
        ))
    ) {
      return { status: 400, body: { error: "Invalid mark-seen body" } };
    }
    const ids = candidateIds as number[] | undefined;
    const engramId = Number(m[1]);
    if (await store.isArchivalEngram(engramId)) return archivalReadOnly();
    const marked = await store.markTransmissionsSeen(engramId, ids);
    return ok({ marked });
  }

  if ((m = url.match(/^\/api\/engrams\/(\d+)\/transmit$/)) && method === "POST") {
    return handleTransmit(Number(m[1]));
  }

  if (url === "/api/openai/conversations" && method === "POST") {
    const conversation = parsed as {
      title?: unknown;
      mode?: unknown;
      personaName?: unknown;
      customEngram?: unknown;
      engramId?: unknown;
    };
    if (
      typeof conversation.title !== "string" ||
      typeof conversation.mode !== "string" ||
      (conversation.personaName !== undefined &&
        typeof conversation.personaName !== "string") ||
      (conversation.customEngram !== undefined &&
        typeof conversation.customEngram !== "string") ||
      (conversation.engramId !== undefined &&
        (typeof conversation.engramId !== "number" ||
          !Number.isFinite(conversation.engramId)))
    ) {
      return { status: 400, body: { error: "Invalid conversation body" } };
    }
    if (
      typeof conversation.engramId === "number" &&
      (await store.isArchivalEngram(conversation.engramId))
    ) {
      return archivalReadOnly();
    }
    return ok(
      await store.createConversation({
        title: conversation.title,
        mode: conversation.mode,
        personaName: conversation.personaName as string | undefined,
        customEngram: conversation.customEngram as string | undefined,
        engramId: conversation.engramId as number | undefined,
      }),
      201,
    );
  }

  if ((m = url.match(/^\/api\/openai\/conversations\/(\d+)$/)) && method === "GET") {
    const conv = await store.getConversation(Number(m[1]));
    return conv ? ok(conv) : notFound("Conversation not found");
  }

  // Unknown route while offline: report clearly rather than hitting the network.
  return { status: 503, body: { error: "Not available in offline mode" } };
};
