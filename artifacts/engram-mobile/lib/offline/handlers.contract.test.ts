import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ActivateEngramResponse,
  CreateEngramInquiryBody,
  CreateEngramInquiryResponse,
  CreateOpenaiConversationBody,
  CreateOpenaiConversationResponse,
  GetEngramResponse,
  GetOpenaiConversationResponse,
  HealthCheckResponse,
  ListEngramInquiriesResponse,
  ListEngramTransmissionsResponse,
  ListEngramsResponse,
  MarkTransmissionsSeenBody,
  MarkTransmissionsSeenResponse,
  TransmitEngramResponse,
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
};

const database = {
  execAsync: vi.fn(async () => {}),
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
      });
      return { lastInsertRowId: id, changes: 1 };
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
    if (sql.includes("FROM world_model")) return [];
    return [];
  }),
};

mocks.database = database;

import { offlineHandler } from "./handlers";
import { getDb } from "./store";

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