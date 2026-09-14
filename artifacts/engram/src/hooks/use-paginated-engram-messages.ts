import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListEngramMessagesQueryKey,
  getListEngramMessagesQueryOptions,
  useListEngramMessages,
  type EngramMessage,
  type ListEngramMessagesChannel,
} from "@workspace/api-client-react";

const DEFAULT_PAGE_SIZE = 100;

function compareNewestFirst(a: EngramMessage, b: EngramMessage): number {
  const createdAt = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  return createdAt || b.id - a.id;
}

function mergeMessages(
  current: EngramMessage[],
  incoming: EngramMessage[],
): EngramMessage[] {
  const byId = new Map<number, EngramMessage>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareNewestFirst);
}

export function usePaginatedEngramMessages(
  channel: ListEngramMessagesChannel,
  pageSize = DEFAULT_PAGE_SIZE,
) {
  const queryClient = useQueryClient();
  const latestParams = { channel, limit: pageSize };
  const latestQuery = useListEngramMessages(latestParams, {
    query: {
      queryKey: getListEngramMessagesQueryKey(latestParams),
      refetchInterval: 15000,
    },
  });
  const [messages, setMessages] = useState<EngramMessage[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);

  useEffect(() => {
    if (!latestQuery.data) return;
    setMessages((current) => mergeMessages(current, latestQuery.data));
    setHasOlder(latestQuery.data.length === pageSize);
  }, [latestQuery.data, pageSize]);

  async function loadOlder() {
    if (isLoadingOlder || !hasOlder || messages.length === 0) return;
    const oldest = messages[messages.length - 1];
    setIsLoadingOlder(true);
    try {
      const older = await queryClient.fetchQuery(
        getListEngramMessagesQueryOptions({
          channel,
          limit: pageSize,
          before: oldest.createdAt,
          beforeId: oldest.id,
        }),
      );
      setMessages((current) => mergeMessages(current, older));
      setHasOlder(older.length === pageSize);
    } finally {
      setIsLoadingOlder(false);
    }
  }

  return {
    messages,
    isLoading: latestQuery.isLoading && messages.length === 0,
    isLoadingOlder,
    hasOlder,
    loadOlder,
    latestQueryKey: getListEngramMessagesQueryKey(latestParams),
  };
}