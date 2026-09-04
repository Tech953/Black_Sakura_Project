import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  initLlama: vi.fn(),
  getModelStatus: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("./native", () => ({ loadLlamaModule: () => ({ initLlama: mocks.initLlama }) }));
vi.mock("./model", () => ({
  MODEL_PATH: "file:///models/test.gguf",
  getModelStatus: mocks.getModelStatus,
}));

import {
  completeStream,
  releaseLlm,
  type ChatMessage,
} from "./llm";
import { OFFLINE_LIMITS } from "./limits";

const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function readyContext() {
  return {
    completion: vi.fn(async () => ({ text: "done" })),
    stopCompletion: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };
}

describe("offline llama lifecycle failure harness", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.initLlama.mockReset();
    mocks.getModelStatus.mockReset();
    mocks.getModelStatus.mockResolvedValue({ state: "ready", bytes: 1 });
  });

  afterEach(async () => {
    await releaseLlm();
    vi.useRealTimers();
  });

  it("retries initialization after native init failure", async () => {
    const context = readyContext();
    mocks.initLlama
      .mockRejectedValueOnce(new Error("native init failed"))
      .mockResolvedValueOnce(context);

    await expect(completeStream(messages, vi.fn())).rejects.toThrow(
      "native init failed",
    );
    await expect(completeStream(messages, vi.fn())).resolves.toBe("done");

    expect(mocks.initLlama).toHaveBeenCalledTimes(2);
  });

  it("holds release until an active generation finishes", async () => {
    let finish: ((value: { text: string }) => void) | undefined;
    const context = readyContext();
    context.completion.mockImplementation(
      () =>
        new Promise<{ text: string }>((resolve) => {
          finish = resolve;
        }),
    );
    mocks.initLlama.mockResolvedValue(context);

    const generation = completeStream(messages, vi.fn());
    await flushMicrotasks();
    expect(context.completion).toHaveBeenCalled();

    const release = releaseLlm();
    await flushMicrotasks();
    expect(context.release).not.toHaveBeenCalled();

    finish?.({ text: "finished" });
    await expect(generation).resolves.toBe("finished");
    await release;
    expect(context.release).toHaveBeenCalledTimes(1);
  });

  it("stops a generation at the watchdog and reports a timeout", async () => {
    vi.useFakeTimers();
    let finish: ((value: { text: string }) => void) | undefined;
    const context = readyContext();
    context.completion.mockImplementation(
      () =>
        new Promise<{ text: string }>((resolve) => {
          finish = resolve;
        }),
    );
    context.stopCompletion.mockImplementation(async () => {
      finish?.({ text: "stopped" });
    });
    mocks.initLlama.mockResolvedValue(context);

    const generation = completeStream(messages, vi.fn()).catch((error) => error);
    await vi.waitFor(() => expect(context.completion).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(OFFLINE_LIMITS.maxGenerationMs);

    await expect(generation).resolves.toMatchObject({
      code: "GENERATION_TIMEOUT",
    });
    expect(context.stopCompletion).toHaveBeenCalledTimes(1);
  });

  it("contains a native stop failure while still cleaning up the generation", async () => {
    vi.useFakeTimers();
    let finish: ((value: { text: string }) => void) | undefined;
    const context = readyContext();
    context.completion.mockImplementation(
      () =>
        new Promise<{ text: string }>((resolve) => {
          finish = resolve;
        }),
    );
    context.stopCompletion.mockRejectedValue(new Error("native stop failed"));
    mocks.initLlama.mockResolvedValue(context);

    const generation = completeStream(messages, vi.fn()).catch((error) => error);
    await vi.waitFor(() => expect(context.completion).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(OFFLINE_LIMITS.maxGenerationMs);
    finish?.({ text: "late result" });

    await expect(generation).resolves.toMatchObject({
      code: "GENERATION_TIMEOUT",
    });
    expect(context.stopCompletion).toHaveBeenCalledTimes(1);
  });

  it("contains a native release failure and permits a later retry", async () => {
    const firstContext = readyContext();
    firstContext.release.mockRejectedValue(new Error("native release failed"));
    const secondContext = readyContext();
    mocks.initLlama
      .mockResolvedValueOnce(firstContext)
      .mockResolvedValueOnce(secondContext);

    await expect(completeStream(messages, vi.fn())).resolves.toBe("done");
    await expect(releaseLlm()).resolves.toBeUndefined();
    await expect(completeStream(messages, vi.fn())).resolves.toBe("done");
    expect(mocks.initLlama).toHaveBeenCalledTimes(2);
  });

  it("never emits fragmented or complete Qwen think blocks", async () => {
    const context = readyContext();
    context.completion.mockImplementation(async (_opts, onToken) => {
      for (const token of ["<th", "ink>secret", "</thi", "nk>Hel", "lo"]) {
        onToken({ token });
      }
      return { text: "<think>secret</think>Hello" };
    });
    mocks.initLlama.mockResolvedValue(context);
    const deltas: string[] = [];

    await expect(completeStream(messages, (delta) => deltas.push(delta))).resolves.toBe(
      "Hello",
    );
    expect(deltas.join("")).toBe("Hello");
    expect(deltas.join("")).not.toContain("secret");
  });
});