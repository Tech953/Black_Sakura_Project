import { describe, expect, it } from "vitest";

import {
  OFFLINE_LIMITS,
  OfflineInputError,
  assertOfflineInput,
  boundChatMessages,
} from "./limits";

describe("offline inference limits", () => {
  it("rejects oversized user input before it reaches native inference", () => {
    expect(() =>
      assertOfflineInput("x".repeat(OFFLINE_LIMITS.maxInputChars + 1)),
    ).toThrowError(OfflineInputError);
  });

  it("keeps the system prompt and the newest turns within the context budget", () => {
    const result = boundChatMessages([
      { role: "system", content: "system ".repeat(2000) },
      { role: "user", content: "old ".repeat(1000) },
      { role: "assistant", content: "older reply ".repeat(1000) },
      { role: "user", content: "newest question" },
    ]);

    expect(result[0].role).toBe("system");
    expect(result.at(-1)?.content).toBe("newest question");
    expect(result.reduce((total, message) => total + message.content.length, 0))
      .toBeLessThanOrEqual(OFFLINE_LIMITS.maxContextChars);
  });

  it("trims individual history turns instead of passing unbounded text", () => {
    const [message] = boundChatMessages([
      { role: "user", content: "a".repeat(OFFLINE_LIMITS.maxHistoryMessageChars + 500) },
    ]);

    expect(message.content.length).toBeLessThanOrEqual(
      OFFLINE_LIMITS.maxHistoryMessageChars + 30,
    );
    expect(message.content).toContain("context trimmed");
  });
});