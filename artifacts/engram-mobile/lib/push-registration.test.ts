import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storageGet: vi.fn(),
  storageSet: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: mocks.storageGet,
    setItem: mocks.storageSet,
  },
}));

describe("push registration status", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.storageGet.mockReset();
    mocks.storageSet.mockReset();
    mocks.storageSet.mockResolvedValue(undefined);
  });

  it("broadcasts and persists only the finite status, never a push token", async () => {
    const {
      getPushRegistrationState,
      setPushRegistrationStatus,
      subscribePushRegistration,
    } = await import("./push-registration");
    const listener = vi.fn();
    const unsubscribe = subscribePushRegistration(listener);

    setPushRegistrationStatus("registered");

    expect(getPushRegistrationState()).toMatchObject({
      status: "registered",
      canAskAgain: null,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(mocks.storageSet).toHaveBeenCalledOnce();
    expect(JSON.parse(mocks.storageSet.mock.calls[0][1])).not.toHaveProperty(
      "token",
    );

    unsubscribe();
  });

  it("hydrates valid status and ignores malformed status", async () => {
    mocks.storageGet.mockResolvedValueOnce(
      JSON.stringify({
        status: "permission-denied",
        canAskAgain: false,
        updatedAt: 123,
      }),
    );
    const first = await import("./push-registration");
    await first.hydratePushRegistrationStatus();
    expect(first.getPushRegistrationState()).toEqual({
      status: "permission-denied",
      canAskAgain: false,
      updatedAt: 123,
    });

    vi.resetModules();
    mocks.storageGet.mockResolvedValueOnce(
      JSON.stringify({ status: "not-a-real-status" }),
    );
    const second = await import("./push-registration");
    await second.hydratePushRegistrationStatus();
    expect(second.getPushRegistrationState().status).toBe("unknown");
  });
});