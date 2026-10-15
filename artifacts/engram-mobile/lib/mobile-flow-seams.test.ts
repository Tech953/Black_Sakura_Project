import { describe, expect, it } from "vitest";

import {
  consumeSseChunk,
  flushSseChunk,
  inquiryRequest,
  loadSelectedEngramId,
  markSeenRequest,
  persistSelectedEngramId,
  selectedEngramStorageKey,
  type KeyValueStorage,
  type SseParserState,
  unseenTransmissionIds,
} from "./mobile-flow-seams";

function memoryStorage(): KeyValueStorage {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
  };
}

describe("mobile core flow seams", () => {
  it("persists selected engrams per account and clears a selection", async () => {
    const storage = memoryStorage();

    await persistSelectedEngramId(storage, "alice", 7);
    await persistSelectedEngramId(storage, "bob", 3);

    expect(await loadSelectedEngramId(storage, "alice")).toBe(7);
    expect(await loadSelectedEngramId(storage, "bob")).toBe(3);

    await persistSelectedEngramId(storage, "alice", null);
    expect(await loadSelectedEngramId(storage, "alice")).toBeNull();
    expect(await loadSelectedEngramId(storage, "bob")).toBe(3);
  });

  it("rejects invalid persisted selection values", async () => {
    const storage = memoryStorage();
    await storage.setItem(selectedEngramStorageKey("bad"), "not-an-id");
    expect(await loadSelectedEngramId(storage, "bad")).toBeNull();
  });

  it("builds feed mark-seen requests only for unseen transmissions", () => {
    const ids = unseenTransmissionIds([
      { id: 10, seen: true },
      { id: 11, seen: false },
      { id: 12, seen: false },
    ]);
    expect(ids).toEqual([11, 12]);
    expect(markSeenRequest(42, ids)).toEqual({
      id: 42,
      data: { ids: [11, 12] },
    });
  });

  it("builds trimmed probe and develop inquiry requests", () => {
    expect(
      inquiryRequest({
        engramId: 8,
        mode: "probe",
        question: "  Who are you?  ",
        language: "en",
      }),
    ).toEqual({
      id: 8,
      data: { kind: "probe", question: "Who are you?", language: "en" },
    });
    expect(
      inquiryRequest({
        engramId: 8,
        mode: "develop",
        question: "  Change your voice  ",
      }),
    ).toEqual({
      id: 8,
      data: { kind: "develop", question: "Change your voice", language: undefined },
    });
  });

  it("parses fragmented SSE chat deltas and terminal events", () => {
    const state: SseParserState = { buffer: "" };
    expect(consumeSseChunk(state, 'data: {"content":"Hel')).toEqual({
      deltas: [],
      done: false,
    });
    expect(
      consumeSseChunk(state, 'lo"}\n\ndata: {"content":" world"}\n'),
    ).toEqual({ deltas: ["Hello", " world"], done: false });
    expect(consumeSseChunk(state, "data: [DONE]\n")).toEqual({
      deltas: [],
      done: true,
    });
    expect(flushSseChunk(state)).toEqual({ deltas: [], done: false });
  });

  it("parses the final unterminated SSE line and surfaces stream errors", () => {
    const state: SseParserState = { buffer: "" };
    consumeSseChunk(state, 'data: {"content":"tail"}');
    expect(flushSseChunk(state)).toEqual({
      deltas: ["tail"],
      done: false,
    });

    const errorState: SseParserState = { buffer: "" };
    expect(() =>
      consumeSseChunk(errorState, 'data: {"error":"provider unavailable"}\n'),
    ).toThrow("provider unavailable");
  });
});