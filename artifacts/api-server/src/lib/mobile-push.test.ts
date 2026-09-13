import { engineHarness as h } from "../test/db-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => h.schema);
vi.mock("drizzle-orm", () => h.drizzle);
vi.mock("./logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import {
  claimTransmissionPush,
  sendTransmissionPush,
} from "./mobile-push";

const ownerId = "owner-a";
const tokenA = "ExpoPushToken[device-a]";
const tokenB = "ExponentPushToken[device-b]";

function seedToken(token: string, tokenOwner = ownerId, platform = "android") {
  h.store.mobilePushTokensTable.push({
    id: h.store.mobilePushTokensTable.length + 1,
    ownerId: tokenOwner,
    token,
    platform,
  });
}

beforeEach(() => {
  h.reset();
  vi.restoreAllMocks();
});

describe("sendTransmissionPush", () => {
  it("sends only the owner's tokens with bounded content and deep-link data", async () => {
    seedToken(tokenA);
    seedToken(tokenB);
    seedToken("ExpoPushToken[other-owner]", "owner-b", "ios");
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: "ok" }, { status: "ok" }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const content = `  ${"A".repeat(200)}\nwith trailing whitespace  `;
    await sendTransmissionPush({
      ownerId,
      engramId: 42,
      engramName: "Testra",
      transmissionId: 99,
      content,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://exp.host/--/api/v2/push/send");
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "content-type": "application/json" });

    const payload = JSON.parse(String(options.body)) as Array<Record<string, unknown>>;
    expect(payload).toHaveLength(2);
    expect(payload.map((message) => message.to)).toEqual([tokenA, tokenB]);
    expect(payload[0]).toMatchObject({
      title: "Testra",
      body: `${"A".repeat(157)}…`,
      sound: "default",
      priority: "high",
      channelId: "engram-outreach",
      data: {
        type: "engram-transmission",
        engramId: "42",
        transmissionId: "99",
      },
    });
    expect(String(payload[0].body).length).toBe(158);
  });

  it("removes only tokens rejected as no longer registered", async () => {
    seedToken(tokenA);
    seedToken(tokenB);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
          {
            status: "error",
            details: { error: "MessageTooBig" },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendTransmissionPush({
      ownerId,
      engramId: 42,
      engramName: "Testra",
      transmissionId: 99,
      content: "A short transmission.",
    });

    expect(h.store.mobilePushTokensTable).toMatchObject([
      {
        token: tokenB,
        ownerId,
      },
    ]);
  });
});

describe("claimTransmissionPush", () => {
  it("claims a transmission once and rejects subsequent claims", async () => {
    h.store.engramTransmissionsTable.push({
      id: 99,
      pushNotifiedAt: null,
    });

    await expect(claimTransmissionPush(99)).resolves.toBe(true);
    await expect(claimTransmissionPush(99)).resolves.toBe(false);
    expect(h.store.engramTransmissionsTable[0].pushNotifiedAt).toBeInstanceOf(
      Date,
    );
  });

  it("does not claim a transmission that was already notified", async () => {
    const notifiedAt = new Date("2026-09-13T14:00:00.000Z");
    h.store.engramTransmissionsTable.push({
      id: 99,
      pushNotifiedAt: notifiedAt,
    });

    await expect(claimTransmissionPush(99)).resolves.toBe(false);
    expect(h.store.engramTransmissionsTable[0].pushNotifiedAt).toBe(notifiedAt);
  });
});