import type { EngramMessage } from "@workspace/api-client-react";

type HubMessageCursor = Pick<EngramMessage, "id" | "createdAt">;

export const HUB_HUMAN_MESSAGE_PAGE_SIZE = 100;

export function compareHubMessagesNewestFirst(
  a: HubMessageCursor,
  b: HubMessageCursor,
): number {
  const createdAt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return createdAt || b.id - a.id;
}

export function mergeHubMessages<T extends HubMessageCursor>(
  current: readonly T[],
  incoming: readonly T[],
): T[] {
  const byId = new Map<number, T>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareHubMessagesNewestFirst);
}

export function getHubOlderPageParams(
  oldest: HubMessageCursor | undefined,
  pageSize = HUB_HUMAN_MESSAGE_PAGE_SIZE,
) {
  if (!oldest) return null;
  return {
    channel: "human" as const,
    limit: pageSize,
    before: oldest.createdAt,
    beforeId: oldest.id,
  };
}

export type HubHistoryControlState =
  | "hidden"
  | "loadOlder"
  | "loading"
  | "retry"
  | "exhausted";

export function getHubHistoryControlState({
  enabled,
  hasMessages,
  historyReady,
  hasOlder,
  isLoading,
  hasError,
}: {
  enabled: boolean;
  hasMessages: boolean;
  historyReady: boolean;
  hasOlder: boolean;
  isLoading: boolean;
  hasError: boolean;
}): HubHistoryControlState {
  if (!enabled || !hasMessages || !historyReady) return "hidden";
  if (isLoading) return "loading";
  if (hasError) return "retry";
  return hasOlder ? "loadOlder" : "exhausted";
}

export type HubHistoryControlTextKey =
  | "hub.loadOlderMessages"
  | "hub.loadingOlderMessages"
  | "hub.retryOlderMessages"
  | "hub.noOlderMessages";

export function getHubHistoryControlTextKey(
  state: HubHistoryControlState,
): HubHistoryControlTextKey | null {
  switch (state) {
    case "loadOlder":
      return "hub.loadOlderMessages";
    case "loading":
      return "hub.loadingOlderMessages";
    case "retry":
      return "hub.retryOlderMessages";
    case "exhausted":
      return "hub.noOlderMessages";
    case "hidden":
      return null;
  }
}

export function getHubHistoryFailureTextKey(
  state: HubHistoryControlState,
): "hub.olderMessagesLoadFailed" | null {
  return state === "retry" ? "hub.olderMessagesLoadFailed" : null;
}
