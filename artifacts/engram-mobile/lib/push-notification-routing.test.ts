import type { NotificationResponse } from "expo-notifications";
import { describe, expect, it, vi } from "vitest";

import {
  handleLastNotificationResponse,
  handleNotificationResponse,
  MOBILE_FEED_ROUTE,
} from "./push-notification-routing";

function responseWithData(data: unknown): NotificationResponse {
  return {
    notification: {
      request: {
        content: { data },
      },
    },
  } as NotificationResponse;
}

function handlers() {
  return {
    selectEngram: vi.fn(),
    replace: vi.fn(),
  };
}

describe("push notification routing", () => {
  it("routes a valid cold-start response to the selected engram Feed", async () => {
    const current = handlers();
    const getLastNotificationResponse = vi
      .fn()
      .mockResolvedValue(responseWithData({ engramId: "42" }));

    await expect(
      handleLastNotificationResponse(getLastNotificationResponse, current),
    ).resolves.toBe(true);

    expect(getLastNotificationResponse).toHaveBeenCalledOnce();
    expect(current.selectEngram).toHaveBeenCalledOnce();
    expect(current.selectEngram).toHaveBeenCalledWith(42);
    expect(current.replace).toHaveBeenCalledOnce();
    expect(current.replace).toHaveBeenCalledWith(MOBILE_FEED_ROUTE);
  });

  it.each([
    ["missing response", null],
    ["missing data", responseWithData(undefined)],
    ["malformed ID", responseWithData({ engramId: "not-a-number" })],
    ["zero ID", responseWithData({ engramId: 0 })],
    ["negative ID", responseWithData({ engramId: -7 })],
  ])("ignores %s without changing navigation", (_label, response) => {
    const current = handlers();

    expect(handleNotificationResponse(response, current)).toBe(false);
    expect(current.selectEngram).not.toHaveBeenCalled();
    expect(current.replace).not.toHaveBeenCalled();
  });

  it("ignores a missing cold-start response", async () => {
    const current = handlers();

    await expect(
      handleLastNotificationResponse(async () => null, current),
    ).resolves.toBe(false);

    expect(current.selectEngram).not.toHaveBeenCalled();
    expect(current.replace).not.toHaveBeenCalled();
  });
});