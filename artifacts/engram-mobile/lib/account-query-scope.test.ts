import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  getAccountLiveStateQueryKey,
  isAccountReadyFor,
} from "./account-query-scope";

describe("mobile live-state query account scope", () => {
  it("does not return cached telemetry for another account or backend", () => {
    const client = new QueryClient();
    const accountALiveState = [{ engramId: 1, topCharge: 0.86 }];
    const accountAKey = getAccountLiveStateQueryKey("account-a", false);

    client.setQueryData(accountAKey, accountALiveState);

    expect(client.getQueryData(accountAKey)).toEqual(accountALiveState);
    expect(
      client.getQueryData(getAccountLiveStateQueryKey("account-b", false)),
    ).toBeUndefined();
    expect(
      client.getQueryData(getAccountLiveStateQueryKey("account-a", true)),
    ).toBeUndefined();
    client.clear();
  });

  it("only renders account data after that same account is ready", () => {
    expect(isAccountReadyFor("account-a", "account-a")).toBe(true);
    expect(isAccountReadyFor("account-b", "account-a")).toBe(false);
    expect(isAccountReadyFor(null, "account-a")).toBe(false);
    expect(isAccountReadyFor("account-a", null)).toBe(false);
  });
});
