import { getGetEngramStatesQueryKey } from "@workspace/api-client-react";

export function getAccountLiveStateQueryKey(
  accountId: string | null,
  offlineActive: boolean,
) {
  return [
    ...getGetEngramStatesQueryKey(),
    offlineActive ? "offline-selection" : "online-selection",
    "account",
    accountId ?? "signed-out",
  ] as const;
}

export function isAccountReadyFor(
  activeAccountId: string | null,
  readyAccountId: string | null,
) {
  return Boolean(activeAccountId && readyAccountId === activeAccountId);
}
