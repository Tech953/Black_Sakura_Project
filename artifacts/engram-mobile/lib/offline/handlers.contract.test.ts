import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorldModelEntry } from "@workspace/api-client-react";

import {
  ActivateEngramResponse,
  CreateEngramInquiryBody,
  CreateEngramInquiryResponse,
  CreateOpenaiConversationBody,
  CreateOpenaiConversationResponse,
  GetEngramResponse,
  GetOpenaiConversationResponse,
  HealthCheckResponse,
  ListOpenaiConversationsResponse,
  ListEngramInquiriesResponse,
  ListEngramMessagesResponse,
  ListEngramTransmissionsResponse,
  ListEngramWorldModelResponse,
  ListEngramsResponse,
  MarkEngramMessagesSeenBody,
  MarkEngramMessagesSeenResponse,
  MarkTransmissionsSeenBody,
  MarkTransmissionsSeenResponse,
  TransmitEngramResponse,
  ReplyToEngramMessageResponse,
} from "../../../../lib/api-zod/src/generated/api";

const mocks = vi.hoisted(() => ({
  database: null as unknown,
  completeOnce: vi.fn(),
  resolveReplyLanguage: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(async () => mocks.database),
}));
vi.mock("./llm", () => ({
  completeOnce: mocks.completeOnce,
}));
vi.mock("../i18n", () => ({
  resolveReplyLanguage: mocks.resolveReplyLanguage,
}));

type Row = Record<string, unknown>;

const state = {
  engrams: [] as Row[],
  inquiries: [] as Row[],
  transmissions: [] as Row[],
  conversations: [] as Row[],
  messages: [] as Row[],
  humanMessages: [] as Row[],
  pendingHumanSeen: [] as Row[],
  operatorReplies: [] as Row[],
};

const database = {
  execAsync: vi.fn(async () => {}),
  withTransactionAsync: vi.fn(async (fn: () => Promise<void>) => fn()),
  runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
    if (sql.includes("INSERT OR IGNORE INTO engrams")) {
      const [slug, data, currentMood, createdAt, updatedAt] = args;
      if (!state.engrams.some((row) => row.slug === slug)) {
        state.engrams.push({
          id: state.engrams.length + 1,
          slug,
          data,
          currentMood,
          isChatActive: state.engrams.length === 0 ? 1 : 0,
          createdAt,
          updatedAt,
        });
      }
      return { lastInsertRowId: state.engrams.length, changes: 1 };
    }
    if (sql.includes("SET isChatActive = 0")) {
      for (const row of state.engrams) row.isChatActive = 0;
      return { lastInsertRowId: 0, changes: 1 };
    }
    if (sql.includes("SET isChatActive = 1")) {
      const [, id] = args;
      const row = state.engrams.find((candidate) => candidate.id === id);
      if (row) {
        row.isChatActive = 1;
        row.updatedAt = args[0];
      }
      return { lastInsertRowId: 0, changes: row ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO conversations")) {
      const [
        title,
        mode,
        personaName,
        customEngram,
        engramId,
        groupContinuationMode,
        createdAt,
      ] = args;
      const id = state.conversations.length + 1;
      state.conversations.push({
        id,
        title,
        mode,
        personaName,
        customEngram,
        engramId,
        groupContinuationMode,
        createdAt,
        archivedAt: null,
        syncVersion: 0,
        syncedAt: null,
      });
      return { lastInsertRowId: id, changes: 1 };
    }
    if (sql.includes("UPDATE conversations")) {
      const [archivedAt, id] = args;
      const row = state.conversations.find((candidate) => candidate.id === id);
      if (row) {
        row.archivedAt = archivedAt;
        row.syncVersion = Number(row.syncVersion ?? 0) + 1;
        row.syncedAt = null;
      }
      return { lastInsertRowId: 0, changes: row ? 1 : 0 };
    }
    if (sql.includes("INSERT INTO inquiries")) {
      const [engramId, kind, question, response, createdAt] = args;
      const id = state.inquiries.length + 1;
      state.inquiries.push({
        id,
        engramId,
        kind,
        question,
        response,
        configDelta: null,
        createdAt,
      });
      return { lastInsertRowId: id, changes: 1 };
    }
    if (sql.includes("INSERT INTO transmissions")) {
      const [
        engramId,
        kind,
        drive,
        content,
        mood,
        importanceScore,
        confidenceScore,
        noveltyScore,
        overallScore,
        createdAt,
      ] = args;
      const id = state.transmissions.length + 1;
      state.transmissions.push({
        id,
        engramId,
        kind,
        drive,
        content,
        mood,
        importanceScore,
        confidenceScore,
        noveltyScore,
        overallScore,
        wasDelivered: 1,
        seen: 0,
        createdAt,
      });
      return { lastInsertRowId: id, changes: 1 };
    }
    if (sql.includes("UPDATE transmissions")) {
      const [engramId, ...ids] = args as number[];
      let changes = 0;
      for (const row of state.transmissions) {
        const selected =
          row.engramId === engramId &&
          (ids.length === 0 || ids.includes(Number(row.id)));
        if (selected && row.seen === 0) {
          row.seen = 1;
          changes += 1;
        }
      }
      return { lastInsertRowId: 0, changes };
    }
    if (sql.includes("UPDATE human_messages SET data")) {
      const [data, id] = args;
      const row = state.humanMessages.find((candidate) => candidate.id === id);
      if (row) row.data = data;
      return { lastInsertRowId: 0, changes: row ? 1 : 0 };
    }
    if (sql.includes("INSERT OR REPLACE INTO human_messages")) {
      const [id, data, cachedAt] = args;
      const row = state.humanMessages.find((candidate) => candidate.id === id);
      if (row) {
        Object.assign(row, { data, cachedAt });
      } else {
        state.humanMessages.push({ id, data, cachedAt });
      }
      return { lastInsertRowId: Number(id), changes: 1 };
    }
    if (sql.includes("INSERT OR IGNORE INTO pending_human_seen")) {
      const [messageId, queuedAt] = args;
      if (!state.pendingHumanSeen.some((row) => row.messageId === messageId)) {
        state.pendingHumanSeen.push({ messageId, queuedAt });
      }
      return { lastInsertRowId: 0, changes: 1 };
    }
    if (sql.includes("INSERT INTO operator_replies")) {
      const [syncId, messageId, content, createdAt] = args;
      const id = state.operatorReplies.length + 1;
      state.operatorReplies.push({ id, syncId, messageId, content, createdAt, syncedAt: null });
      return { lastInsertRowId: id, changes: 1 };
    }
    return { lastInsertRowId: 0, changes: 0 };
  }),
  getFirstAsync: vi.fn(async (sql: string, id: unknown) => {
    if (sql.includes("slug = ?")) return { id: 999 };
    if (sql.includes("FROM engrams")) {
      return state.engrams.find((row) => row.id === id) ?? null;
    }
    if (sql.includes("FROM conversations")) {
      return state.conversations.find((row) => row.id === id) ?? null;
    }
    if (sql.includes("FROM human_messages")) {
      return state.humanMessages.find((row) => row.id === id) ?? null;
    }
    if (sql.includes("FROM pending_human_seen")) {
      return state.pendingHumanSeen.find((row) => row.messageId === id) ?? null;
    }
    return null;
  }),
  getAllAsync: vi.fn(async (sql: string, id?: unknown) => {
    if (sql.includes("FROM engrams")) return [...state.engrams];
    if (sql.includes("FROM inquiries")) {
      return state.inquiries
        .filter((row) => row.engramId === id)
        .reverse();
    }
    if (sql.includes("FROM transmissions")) {
      return state.transmissions
        .filter((row) => row.engramId === id)
        .reverse();
    }
    if (sql.includes("FROM messages")) {
      return state.messages.filter((row) => row.conversationId === id);
    }
    if (sql.includes("FROM conversations c")) return [...state.conversations];
    if (sql.includes("FROM world_model")) return [];
    if (sql.includes("FROM human_messages")) return [...state.humanMessages];
    if (sql.includes("FROM pending_human_seen")) {
      return [...state.pendingHumanSeen];
    }
    if (sql.includes("FROM operator_replies")) return [...state.operatorReplies];
    return [];
  }),
};

mocks.database = database;

import { offlineHandler } from "./handlers";
import { buildPendingSyncBatch, cacheHumanMessages, getDb } from "./store";
import { getOperatorReplyDisplayState } from "../reply-acknowledgement";

const ErrorResponse = z.object({ error: z.string() });

type Contract = {
  parse(value: unknown): unknown;
};

async function request(method: string, path: string, body?: unknown) {
  return offlineHandler({
    method,
    path,
    body:
      typeof body === "string"
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  } as Parameters<typeof offlineHandler>[0]);
}

function expectContract(
  response: Awaited<ReturnType<typeof request>>,
  status: number,
  schema: Contract,
) {
  expect(response?.status).toBe(status);
  expect(() => schema.parse(response?.body)).not.toThrow();
  return response?.body as Row;
}

describe("offline handler generated response contracts", () => {
  beforeAll(async () => {
    await getDb();
  });

  beforeEach(() => {
    state.inquiries.length = 0;
    state.transmissions.length = 0;
    state.conversations.length = 0;
    state.messages.length = 0;
    state.humanMessages.length = 0;
    state.pendingHumanSeen.length = 0;
    state.operatorReplies.length = 0;
    for (const [index, engram] of state.engrams.entries()) {
      engram.isChatActive = index === 0 ? 1 : 0;
    }
    mocks.completeOnce.mockReset();
    mocks.completeOnce.mockResolvedValue("Offline answer");
    mocks.resolveReplyLanguage.mockReset();
    mocks.resolveReplyLanguage.mockResolvedValue("en");
  });

  it("matches health and engram list/get/activate contracts", async () => {
    expectContract(await request("GET", "/api/healthz"), 200, HealthCheckResponse);

    const listed = await request("GET", "/api/engrams");
    expectContract(listed, 200, ListEngramsResponse);
    const firstId = Number((listed?.body as Row[])[0].id);

    expectContract(
      await request("GET", `/api/engrams/${firstId}`),
      200,
      GetEngramResponse,
    );
    const activated = expectContract(
      await request("POST", `/api/engrams/${firstId}/activate`),
      200,
      ActivateEngramResponse,
    );
    expect(activated.isChatActive).toBe(true);
  });

  it("accepts a world-model response that omits its optional source", () => {
    const clientEntry: WorldModelEntry = {
      id: 42,
      engramId: 1,
      provenance: "observed",
      content: "A memory with no source label.",
      confidence: 0.9,
      scope: "private",
      createdAt: "2026-09-04T12:00:00.000Z",
      updatedAt: "2026-09-04T12:00:00.000Z",
    };
    const [entry] = ListEngramWorldModelResponse.parse([clientEntry]);

    expect(entry).not.toHaveProperty("source");
    expect(JSON.parse(JSON.stringify(entry))).not.toHaveProperty("source");
  });

  it("matches cached human messages and queued operator replies", async () => {
    const source = {
      id: 1,
      fromEngramId: 1,
      toEngramId: null,
      spaceId: null,
      channel: "human",
      author: "engram",
      priority: "meaningful",
      status: "delivered",
      content: "Can you hear me?",
      reason: null,
      seen: false,
      isDigest: false,
      digestGroupId: null,
      deliveredAt: "2026-09-13T12:00:00.000Z",
      acknowledgedAt: null,
      createdAt: "2026-09-13T12:00:00.000Z",
    };
    state.humanMessages.push({ id: 1, data: JSON.stringify(source), cachedAt: source.createdAt });

    const listed = expectContract(
      await request("GET", "/api/messages?channel=human"),
      200,
      ListEngramMessagesResponse,
    );
    expect(listed).toEqual([source]);

    const queued = expectContract(
      await request("POST", "/api/messages/1/reply", { content: "I can hear you." }),
      201,
      ReplyToEngramMessageResponse,
    );
    expect(queued).toMatchObject({
      id: -1,
      fromEngramId: 1,
      toEngramId: 1,
      channel: "human",
      author: "operator",
      status: "delivered",
      content: "I can hear you.",
    });
    expect(getOperatorReplyDisplayState(queued)).toEqual({
      saved: true,
      acknowledgement: "pending",
    });
    expect(state.operatorReplies).toHaveLength(1);
    expect(state.operatorReplies[0]).toMatchObject({
      syncId: expect.stringMatching(/^operator-reply:/),
      messageId: 1,
      content: "I can hear you.",
      syncedAt: null,
    });
    const queuedReply = state.operatorReplies[0]!;
    const batch = await buildPendingSyncBatch("phone-a");
    expect(batch.payload.operatorReplies).toEqual([
      expect.objectContaining({
        syncId: queuedReply.syncId,
        messageId: 1,
        content: "I can hear you.",
      }),
    ]);
    expect(batch.localRows.operatorReplyIds).toEqual([queuedReply.syncId]);

    const marked = expectContract(
      await request(
        "POST",
        "/api/messages/mark-seen",
        MarkEngramMessagesSeenBody.parse({ ids: [1] }),
      ),
      200,
      MarkEngramMessagesSeenResponse,
    );
    expect(marked.updated).toBe(1);
    expect(state.pendingHumanSeen.map((row) => row.messageId)).toEqual([1]);

    // A stale response may race the next reconnect sync. Keep the local seen
    // state and the queued reply visible until the server acknowledges both.
    await cacheHumanMessages([source as Parameters<typeof cacheHumanMessages>[0][number]]);
    const refreshed = expectContract(
      await request("GET", "/api/messages?channel=human"),
      200,
      ListEngramMessagesResponse,
    );
    expect(refreshed.find((message) => message.id === 1)?.seen).toBe(true);
    expect(
      refreshed.some(
        (message) => message.author === "operator" && message.content === "I can hear you.",
      ),
    ).toBe(true);
  });

  it("matches inquiry create and list contracts", async () => {
    mocks.resolveReplyLanguage.mockResolvedValue("de");
    const body = CreateEngramInquiryBody.parse({
      kind: "probe",
      question: "What matters to you?",
      language: "es",
    });
    expectContract(
      await request("POST", "/api/engrams/1/inquiries", body),
      201,
      CreateEngramInquiryResponse,
    );
    expectContract(
      await request("GET", "/api/engrams/1/inquiries"),
      200,
      ListEngramInquiriesResponse,
    );
    expect(mocks.resolveReplyLanguage).not.toHaveBeenCalled();
    const prompt = String(
      (mocks.completeOnce.mock.calls[0][0] as Array<{ content: string }>)[0]
        .content,
    );
    expect(prompt).toContain("Spanish");
  });

  it("matches transmit, list, and mark-seen contracts", async () => {
    const transmitted = expectContract(
      await request("POST", "/api/engrams/1/transmit"),
      201,
      TransmitEngramResponse,
    );
    expectContract(
      await request("GET", "/api/engrams/1/transmissions"),
      200,
      ListEngramTransmissionsResponse,
    );
    const markBody = MarkTransmissionsSeenBody.parse({
      ids: [transmitted.id],
    });
    expectContract(
      await request(
        "POST",
        "/api/engrams/1/transmissions/mark-seen",
        markBody,
      ),
      200,
      MarkTransmissionsSeenResponse,
    );
    const listed = await request("GET", "/api/engrams/1/transmissions");
    expectContract(listed, 200, ListEngramTransmissionsResponse);
    expect((listed?.body as Row[])[0].seen).toBe(true);
  });

  it("matches conversation create and detail contracts", async () => {
    const body = CreateOpenaiConversationBody.parse({
      title: "Offline conversation",
      mode: "companion",
      personaName: "Analyst",
      customEngram: "Be concise and evidence-led.",
      engramId: 1,
    });
    const created = expectContract(
      await request("POST", "/api/openai/conversations", body),
      201,
      CreateOpenaiConversationResponse,
    );
    expect(created).toMatchObject({
      personaName: "Analyst",
      customEngram: "Be concise and evidence-led.",
    });
    state.messages.push({
      id: 1,
      conversationId: created.id,
      role: "user",
      content: "Hello",
      createdAt: "2026-09-05T00:00:00.000Z",
    });
    const detail = expectContract(
      await request("GET", `/api/openai/conversations/${created.id}`),
      200,
      GetOpenaiConversationResponse,
    );
    expect(detail).toMatchObject({
      personaName: "Analyst",
      customEngram: "Be concise and evidence-led.",
    });
  });

  it("lists, archives, restores, and re-lists local conversations", async () => {
    const created = expectContract(
      await request("POST", "/api/openai/conversations", {
        title: "Offline history",
        mode: "companion",
        engramId: 1,
      }),
      201,
      CreateOpenaiConversationResponse,
    );

    const active = expectContract(
      await request("GET", "/api/openai/conversations?archived=false"),
      200,
      ListOpenaiConversationsResponse,
    );
    expect(active).toHaveLength(1);
    expect(active[0].archivedAt).toBeNull();

    const archived = await request(
      "PATCH",
      `/api/openai/conversations/${created.id}/archive`,
      { archived: true },
    );
    expect(archived?.status).toBe(200);
    expect((archived?.body as Row).archivedAt).toBeTruthy();

    const archivedList = expectContract(
      await request("GET", "/api/openai/conversations?archived=true"),
      200,
      ListOpenaiConversationsResponse,
    );
    expect(archivedList).toHaveLength(1);

    const restored = await request(
      "PATCH",
      `/api/openai/conversations/${created.id}/archive`,
      { archived: false },
    );
    expect(restored?.status).toBe(200);
    expect((restored?.body as Row).archivedAt).toBeNull();
  });

  it.each([
    ["invalid JSON", "POST", "/api/openai/conversations", "{"],
    ["JSON null", "POST", "/api/openai/conversations", "null"],
    ["JSON array", "POST", "/api/openai/conversations", "[]"],
    [
      "missing inquiry question",
      "POST",
      "/api/engrams/1/inquiries",
      { kind: "probe" },
    ],
    [
      "invalid mark-seen ids",
      "POST",
      "/api/engrams/1/transmissions/mark-seen",
      { ids: "all" },
    ],
    [
      "invalid human-message mark-seen ids",
      "POST",
      "/api/messages/mark-seen",
      { ids: "all" },
    ],
    [
      "missing conversation fields",
      "POST",
      "/api/openai/conversations",
      {},
    ],
  ])("returns a contract-shaped 400 for %s", async (_name, method, path, body) => {
    expectContract(await request(method, path, body), 400, ErrorResponse);
  });

  it("returns contract-shaped not-found responses", async () => {
    expectContract(
      await request("GET", "/api/engrams/99999"),
      404,
      ErrorResponse,
    );
    expectContract(
      await request("GET", "/api/openai/conversations/99999"),
      404,
      ErrorResponse,
    );
  });
});