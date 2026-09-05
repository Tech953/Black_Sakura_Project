import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
  storageRemove: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: mocks.storageGet,
    setItem: mocks.storageSet,
    removeItem: mocks.storageRemove,
  },
}));

let resolveServerApiUrl: typeof import("../server-url").resolveServerApiUrl;

describe("mobile server URL resolution", () => {
  beforeEach(async () => {
    vi.resetModules();
    for (const mock of Object.values(mocks)) mock.mockReset();
    ({ resolveServerApiUrl } = await import("../server-url"));
  });

  it("uses the latest persisted server address for every API request", async () => {
    mocks.storageGet
      .mockResolvedValueOnce("http://192.168.1.20:3101")
      .mockResolvedValueOnce("http://10.0.0.42:4100");

    await expect(
      resolveServerApiUrl("/api/openai/conversations/7/messages"),
    ).resolves.toBe(
      "http://192.168.1.20:3101/api/openai/conversations/7/messages",
    );
    await expect(
      resolveServerApiUrl("api/openai/conversations/7/messages"),
    ).resolves.toBe(
      "http://10.0.0.42:4100/api/openai/conversations/7/messages",
    );
    expect(mocks.storageGet).toHaveBeenCalledTimes(2);
  });
});
