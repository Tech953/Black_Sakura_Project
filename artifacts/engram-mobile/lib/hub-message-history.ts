import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  getListEngramMessagesQueryKey,
  getListEngramMessagesQueryOptions,
  useListEngramMessages,
  type EngramMessage,
} from "@workspace/api-client-react";

import {
  getHubOlderPageParams,
  HUB_HUMAN_MESSAGE_PAGE_SIZE,
  mergeHubMessages,
} from "./hub-message-pagination";

interface PageState {
  scopeKey: string;
  olderMessages: EngramMessage[];
  hasOlder: boolean | null;
  loadOlderError: boolean;
}

function emptyPageState(scopeKey: string): PageState {
  return {
    scopeKey,
    olderMessages: [],
    hasOlder: null,
    loadOlderError: false,
  };
}

export function useHubHumanMessageHistory(
  accountId: string | null,
  offline: boolean,
) {
  const queryClient = useQueryClient();
  const params = {
    channel: "human" as const,
    limit: HUB_HUMAN_MESSAGE_PAGE_SIZE,
  };
  const queryKey = getListEngramMessagesQueryKey(params);
  const query = useListEngramMessages(params, { query: { queryKey } });
  const scopeKey = `${accountId ?? "signed-out"}:${offline ? "offline" : "online"}`;
  const activeScopeRef = useRef(scopeKey);
  activeScopeRef.current = scopeKey;
  const inFlightScopes = useRef(new Set<string>());
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [pageState, setPageState] = useState<PageState>(() =>
    emptyPageState(scopeKey),
  );

  useEffect(() => {
    setPageState((current) =>
      current.scopeKey === scopeKey ? current : emptyPageState(scopeKey),
    );
  }, [scopeKey]);

  const currentPageState =
    pageState.scopeKey === scopeKey ? pageState : emptyPageState(scopeKey);
  const messages = useMemo(
    () => mergeHubMessages(currentPageState.olderMessages, query.data ?? []),
    [currentPageState.olderMessages, query.data],
  );
  const hasOlder =
    currentPageState.hasOlder ??
    (query.data?.length === HUB_HUMAN_MESSAGE_PAGE_SIZE);
  const isLoadingOlder = loadingScope === scopeKey;

  const loadOlder = useCallback(async () => {
    if (
      offline ||
      inFlightScopes.current.has(scopeKey) ||
      !hasOlder ||
      messages.length === 0
    ) {
      return;
    }
    const olderParams = getHubOlderPageParams(
      messages[messages.length - 1],
    );
    if (!olderParams) return;

    inFlightScopes.current.add(scopeKey);
    setLoadingScope(scopeKey);
    setPageState((current) => {
      const active =
        current.scopeKey === scopeKey ? current : emptyPageState(scopeKey);
      return { ...active, loadOlderError: false };
    });
    try {
      const olderPage = await queryClient.fetchQuery({
        ...getListEngramMessagesQueryOptions(olderParams),
        retry: false,
      });
      if (activeScopeRef.current !== scopeKey) return;
      setPageState((current) => {
        const active =
          current.scopeKey === scopeKey ? current : emptyPageState(scopeKey);
        return {
          ...active,
          olderMessages: mergeHubMessages(active.olderMessages, olderPage),
          hasOlder: olderPage.length === HUB_HUMAN_MESSAGE_PAGE_SIZE,
          loadOlderError: false,
        };
      });
    } catch {
      if (activeScopeRef.current === scopeKey) {
        setPageState((current) => {
          const active =
            current.scopeKey === scopeKey ? current : emptyPageState(scopeKey);
          return { ...active, loadOlderError: true };
        });
      }
    } finally {
      inFlightScopes.current.delete(scopeKey);
      setLoadingScope((current) =>
        current === scopeKey ? null : current,
      );
    }
  }, [hasOlder, messages, offline, queryClient, scopeKey]);

  const markMessageSeen = useCallback(
    (messageId: number) => {
      queryClient.setQueryData<EngramMessage[]>(queryKey, (current) =>
        current?.map((message) =>
          message.id === messageId ? { ...message, seen: true } : message,
        ),
      );
      setPageState((current) => {
        if (current.scopeKey !== scopeKey) return current;
        return {
          ...current,
          olderMessages: current.olderMessages.map((message) =>
            message.id === messageId ? { ...message, seen: true } : message,
          ),
        };
      });
    },
    [queryClient, queryKey, scopeKey],
  );

  return {
    query,
    messages,
    hasOlder,
    historyReady: query.data !== undefined,
    isLoadingOlder,
    loadOlderError: currentPageState.loadOlderError,
    loadOlder,
    markMessageSeen,
  };
}
