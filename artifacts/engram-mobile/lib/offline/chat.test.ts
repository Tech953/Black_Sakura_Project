import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeStream: vi.fn(),
  getEngramPersona: vi.fn(),
  loadRecentWorldModel: vi.fn(),
  listMessages: vi.fn(),
  appendMessage: vi.fn(),
  removeLastMessage: vi.fn(),
  appendObservedEntry: vi.fn(),
}));

vi.mock("./llm", () => ({ completeStream: mocks.completeStream }));
vi.mock("./store", () => ({
  getEngramPersona: mocks.getEngramPersona,
  loadRecentWorldModel: mocks.loadRecentWorldModel,
  listMessages: mocks.listMessages,
  appendMessage: mocks.appendMessage,
  removeLastMessage: mocks.removeLastMessage,
  appendObservedEntry: mocks.appendObservedEntry,
}));
vi.mock("../i18n", () => ({
  resolveReplyLanguage: vi.fn(async () => "en"),
}));
vi.mock("@workspace/engram-core", () => ({
  buildEngramSystemPrompt: vi.fn(() => "system"),
  summarizeWorldModel: vi.fn(() => "world"),
}));
vi.mock("@workspace/i18n", () => ({
  responseLanguageInstruction: vi.fn(() => "Reply in English."),
}));

import { sendOfflineMessage } from "./chat";

const persona = {
  id: 7,
  slug: "test-engram",
  name: "Test Engram",
  currentMood: "steady",
  drives: [],
};

describe("offline chat persistence failure harness", () => {
  beforeEach(() => {
    mocks.completeStream.mockReset();
    mocks.getEngramPersona.mockReset().mockResolvedValue(persona);
    mocks.loadRecentWorldModel.mockReset().mockResolvedValue([]);
    mocks.listMessages.mockReset().mockResolvedValue([]);
    mocks.appendMessage.mockReset().mockResolvedValue(undefined);
    mocks.removeLastMessage.mockReset().mockResolvedValue(undefined);
    mocks.appendObservedEntry.mockReset().mockResolvedValue(undefined);
  });

  it("removes the user turn when native generation fails", async () => {
    mocks.completeStream.mockRejectedValue(new Error("native completion failed"));

    await expect(
      sendOfflineMessage({
        conversationId: 11,
        engramId: 7,
        content: "remember this",
        onToken: vi.fn(),
      }),
    ).rejects.toThrow("native completion failed");

    expect(mocks.appendMessage).toHaveBeenCalledWith(11, "user", "remember this");
    expect(mocks.removeLastMessage).toHaveBeenCalledWith(
      11,
      "user",
      "remember this",
    );
    expect(mocks.appendObservedEntry).not.toHaveBeenCalled();
  });

  it("rolls back the user turn when the assistant SQLite write fails", async () => {
    mocks.completeStream.mockResolvedValue("native reply");
    mocks.appendMessage
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SQLite busy"));

    await expect(
      sendOfflineMessage({
        conversationId: 12,
        engramId: 7,
        content: "write this safely",
        onToken: vi.fn(),
      }),
    ).rejects.toThrow("SQLite busy");

    expect(mocks.removeLastMessage).toHaveBeenCalledWith(
      12,
      "user",
      "write this safely",
    );
    expect(mocks.appendObservedEntry).not.toHaveBeenCalled();
  });

  it("writes the observed entry only after the assistant turn persists", async () => {
    mocks.completeStream.mockResolvedValue("native reply");

    await expect(
      sendOfflineMessage({
        conversationId: 13,
        engramId: 7,
        content: "persist after success",
        onToken: vi.fn(),
      }),
    ).resolves.toBe("native reply");

    expect(mocks.appendMessage).toHaveBeenNthCalledWith(
      2,
      13,
      "assistant",
      "native reply",
    );
    expect(mocks.appendObservedEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        engramId: 7,
        source: "chat:13",
        content: 'They said: "persist after success"',
      }),
    );
  });
});