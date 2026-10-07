import { describe, expect, it } from "vitest";

import {
  getHubHistoryControlState,
  getHubHistoryControlTextKey,
  getHubHistoryFailureTextKey,
  getHubOlderPageParams,
  mergeHubMessages,
} from "./hub-message-pagination";

describe("Hub human-message history pagination", () => {
  it("merges refreshes by message id and keeps newest-first order", () => {
    const olderPages = [
      { id: 8, createdAt: "2026-10-07T10:00:00.000Z", content: "old" },
      { id: 7, createdAt: "2026-10-07T09:00:00.000Z", content: "older" },
    ];
    const refreshedLatest = [
      { id: 8, createdAt: "2026-10-07T10:00:00.000Z", content: "updated" },
      { id: 9, createdAt: "2026-10-07T11:00:00.000Z", content: "new" },
      { id: 10, createdAt: "2026-10-07T11:00:00.000Z", content: "newest tie" },
    ];

    expect(mergeHubMessages(olderPages, refreshedLatest)).toEqual([
      { id: 10, createdAt: "2026-10-07T11:00:00.000Z", content: "newest tie" },
      { id: 9, createdAt: "2026-10-07T11:00:00.000Z", content: "new" },
      { id: 8, createdAt: "2026-10-07T10:00:00.000Z", content: "updated" },
      { id: 7, createdAt: "2026-10-07T09:00:00.000Z", content: "older" },
    ]);
  });

  it("uses the oldest loaded row as the paired timestamp and id cursor", () => {
    expect(
      getHubOlderPageParams({
        id: 42,
        createdAt: "2026-10-07T09:30:00.000Z",
      }),
    ).toEqual({
      channel: "human",
      limit: 100,
      before: "2026-10-07T09:30:00.000Z",
      beforeId: 42,
    });
    expect(getHubOlderPageParams(undefined)).toBeNull();
  });

  it("selects localized loading, retry, load, and exhausted-history labels", () => {
    const base = {
      enabled: true,
      hasMessages: true,
      historyReady: true,
      hasOlder: true,
      isLoading: false,
      hasError: false,
    };

    const loading = getHubHistoryControlState({ ...base, isLoading: true });
    expect(loading).toBe("loading");
    expect(getHubHistoryControlTextKey(loading)).toBe(
      "hub.loadingOlderMessages",
    );

    const retry = getHubHistoryControlState({ ...base, hasError: true });
    expect(retry).toBe("retry");
    expect(getHubHistoryControlTextKey(retry)).toBe("hub.retryOlderMessages");
    expect(getHubHistoryFailureTextKey(retry)).toBe(
      "hub.olderMessagesLoadFailed",
    );

    const exhausted = getHubHistoryControlState({
      ...base,
      hasOlder: false,
    });
    expect(exhausted).toBe("exhausted");
    expect(getHubHistoryControlTextKey(exhausted)).toBe("hub.noOlderMessages");

    const canLoad = getHubHistoryControlState(base);
    expect(canLoad).toBe("loadOlder");
    expect(getHubHistoryControlTextKey(canLoad)).toBe("hub.loadOlderMessages");
    expect(getHubHistoryControlState({ ...base, enabled: false })).toBe(
      "hidden",
    );
  });
});
