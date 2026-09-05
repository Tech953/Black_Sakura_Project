import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { isOfflineMode } from "@/lib/offline/mode";

const STORAGE_SELECTED = "engram.selectedId";
const STORAGE_CONVO_MAP = "engram.conversationMap";

// Conversation IDs are backend-specific: server conversations live in the
// server DB, offline conversations in on-device SQLite. Scope map keys by
// mode so an ID from one backend is never reused against the other.
function convoKey(engramId: number): string {
  return isOfflineMode() ? `off:${engramId}` : String(engramId);
}

type ConversationMap = Record<string, number>;

interface EngramContextValue {
  selectedEngramId: number | null;
  setSelectedEngramId: (id: number | null) => void;
  hydrated: boolean;
  getConversationId: (engramId: number) => number | null;
  setConversationId: (engramId: number, conversationId: number) => void;
}

const EngramContext = createContext<EngramContextValue | undefined>(undefined);

export function EngramProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: React.ReactNode;
}) {
  const [selectedEngramId, setSelectedEngramIdState] = useState<number | null>(
    null,
  );
  const [conversationMap, setConversationMap] = useState<ConversationMap>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [storedSelected, storedMap] = await Promise.all([
          AsyncStorage.getItem(`${STORAGE_SELECTED}.${accountId}`),
          AsyncStorage.getItem(`${STORAGE_CONVO_MAP}.${accountId}`),
        ]);
        if (storedSelected != null) {
          const parsed = Number(storedSelected);
          if (!Number.isNaN(parsed)) setSelectedEngramIdState(parsed);
        }
        if (storedMap) {
          setConversationMap(JSON.parse(storedMap) as ConversationMap);
        }
      } catch {
        // ignore corrupt storage
      } finally {
        setHydrated(true);
      }
    })();
  }, [accountId]);

  const setSelectedEngramId = useCallback((id: number | null) => {
    setSelectedEngramIdState(id);
    if (id == null) {
      AsyncStorage.removeItem(`${STORAGE_SELECTED}.${accountId}`).catch(() => {});
    } else {
      AsyncStorage.setItem(`${STORAGE_SELECTED}.${accountId}`, String(id)).catch(() => {});
    }
  }, [accountId]);

  const getConversationId = useCallback(
    (engramId: number): number | null => conversationMap[convoKey(engramId)] ?? null,
    [conversationMap],
  );

  const setConversationId = useCallback(
    (engramId: number, conversationId: number) => {
      setConversationMap((prev) => {
        const next = { ...prev, [convoKey(engramId)]: conversationId };
          AsyncStorage.setItem(`${STORAGE_CONVO_MAP}.${accountId}`, JSON.stringify(next)).catch(
          () => {},
        );
        return next;
      });
    },
    [accountId],
  );

  const value = useMemo(
    () => ({
      selectedEngramId,
      setSelectedEngramId,
      hydrated,
      getConversationId,
      setConversationId,
    }),
    [
      selectedEngramId,
      setSelectedEngramId,
      hydrated,
      getConversationId,
      setConversationId,
    ],
  );

  return (
    <EngramContext.Provider value={value}>{children}</EngramContext.Provider>
  );
}

export function useEngram(): EngramContextValue {
  const ctx = useContext(EngramContext);
  if (!ctx) throw new Error("useEngram must be used within EngramProvider");
  return ctx;
}
