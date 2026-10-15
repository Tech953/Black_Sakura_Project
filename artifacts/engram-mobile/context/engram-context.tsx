import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  getListEngramsQueryKey,
  useListEngrams,
  type Engram,
} from "@workspace/api-client-react";
import { useOfflineMode } from "../lib/offline/mode";
import {
  loadSelectedEngramId,
  persistSelectedEngramId,
} from "../lib/mobile-flow-seams";

const STORAGE_CONVO_MAP = "engram.conversationMap";
const STORAGE_SELECTED_SLUG = "engram.selectedSlug";
const STORAGE_SELECTED_BACKEND = "engram.selectedBackend";
type EngramBackend = "online" | "offline";

function selectedSlugStorageKey(accountId: string): string {
  return `${STORAGE_SELECTED_SLUG}.${accountId}`;
}

export function getEngramListModeQueryKey(offline: boolean) {
  return [
    ...getListEngramsQueryKey(),
    offline ? "offline-selection" : "online-selection",
  ] as const;
}

/** Resolve an identity against one backend's IDs, never another backend's ID. */
export function resolveSelectedEngramId(
  slug: string | null,
  legacyId: number | null,
  legacyBackend: EngramBackend | null,
  activeBackend: EngramBackend,
  engrams: readonly Engram[] | undefined,
): number | null {
  if (!engrams) return null;
  if (slug) return engrams.find((engram) => engram.slug === slug)?.id ?? null;
  if (legacyId == null || legacyBackend !== activeBackend) return null;
  return engrams.some((engram) => engram.id === legacyId) ? legacyId : null;
}

// Conversation IDs are backend-specific: server conversations live in the
// server DB, offline conversations in on-device SQLite. Scope map keys by
// mode so an ID from one backend is never reused against the other.
export function conversationMapKey(
  engramId: number,
  offline: boolean,
): string {
  return offline ? `off:${engramId}` : String(engramId);
}

type ConversationMap = Record<string, number>;

interface EngramContextValue {
  selectedEngramId: number | null;
  setSelectedEngramId: (id: number | null, slug?: string) => void;
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
  const offlineActive = useOfflineMode();
  const activeBackend: EngramBackend = offlineActive ? "offline" : "online";
  const [selectedSlug, setSelectedSlugState] = useState<string | null>(null);
  const [legacySelectedId, setLegacySelectedId] = useState<number | null>(null);
  const [legacySelectionBackend, setLegacySelectionBackend] =
    useState<EngramBackend | null>(null);
  const [conversationMap, setConversationMap] = useState<ConversationMap>({});
  const [hydrated, setHydrated] = useState(false);
  const { data: engrams } = useListEngrams({
    query: {
      enabled: hydrated,
      queryKey: getEngramListModeQueryKey(offlineActive),
    },
  });
  const selectedEngramId = useMemo(
    () =>
      resolveSelectedEngramId(
        selectedSlug,
        legacySelectedId,
        legacySelectionBackend,
        activeBackend,
        engrams,
      ),
    [
      activeBackend,
      engrams,
      legacySelectedId,
      legacySelectionBackend,
      selectedSlug,
    ],
  );

  useEffect(() => {
    (async () => {
      try {
        const [
          storedSelected,
          storedSlug,
          storedBackend,
          storedMap,
        ] = await Promise.all([
          loadSelectedEngramId(AsyncStorage, accountId),
          AsyncStorage.getItem(selectedSlugStorageKey(accountId)),
          AsyncStorage.getItem(`${STORAGE_SELECTED_BACKEND}.${accountId}`),
          AsyncStorage.getItem(`${STORAGE_CONVO_MAP}.${accountId}`),
        ]);
        setLegacySelectedId(storedSelected);
        setSelectedSlugState(storedSlug || null);
        setLegacySelectionBackend(
          storedBackend === "online" || storedBackend === "offline"
            ? storedBackend
            : activeBackend,
        );
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

  // Migrate existing numeric selections using the active backend's engram
  // list, then keep the stable slug as the cross-backend identity.
  useEffect(() => {
    if (!hydrated || !engrams) return;
    if (selectedSlug) {
      const activeId = resolveSelectedEngramId(
        selectedSlug,
        null,
        null,
        activeBackend,
        engrams,
      );
      if (activeId != null && legacySelectedId !== activeId) {
        setLegacySelectedId(activeId);
        persistSelectedEngramId(AsyncStorage, accountId, activeId).catch(
          () => {},
        );
      }
      if (activeId != null && legacySelectionBackend !== activeBackend) {
        setLegacySelectionBackend(activeBackend);
        AsyncStorage.setItem(
          `${STORAGE_SELECTED_BACKEND}.${accountId}`,
          activeBackend,
        ).catch(() => {});
      }
      return;
    }
    if (legacySelectionBackend !== activeBackend) return;
    const legacyEngram = engrams.find(
      (engram) => engram.id === legacySelectedId,
    );
    if (legacyEngram) {
      setSelectedSlugState(legacyEngram.slug);
      AsyncStorage.setItem(
        selectedSlugStorageKey(accountId),
        legacyEngram.slug,
      ).catch(() => {});
    }
  }, [
    accountId,
    activeBackend,
    engrams,
    hydrated,
    legacySelectedId,
    legacySelectionBackend,
    selectedSlug,
  ]);

  const setSelectedEngramId = useCallback(
    (id: number | null, slug?: string) => {
      setLegacySelectedId(id);
      setLegacySelectionBackend(activeBackend);
      const backendKey = `${STORAGE_SELECTED_BACKEND}.${accountId}`;
      if (id == null) {
        AsyncStorage.removeItem(backendKey).catch(() => {});
      } else {
        AsyncStorage.setItem(backendKey, activeBackend).catch(() => {});
      }
      if (id == null) {
        setSelectedSlugState(null);
        AsyncStorage.removeItem(selectedSlugStorageKey(accountId)).catch(
          () => {},
        );
      } else {
        const stableSlug =
          slug ?? engrams?.find((engram) => engram.id === id)?.slug ?? null;
        setSelectedSlugState(stableSlug);
        if (stableSlug) {
          AsyncStorage.setItem(
            selectedSlugStorageKey(accountId),
            stableSlug,
          ).catch(() => {});
        } else {
          AsyncStorage.removeItem(selectedSlugStorageKey(accountId)).catch(
            () => {},
          );
        }
      }
      persistSelectedEngramId(AsyncStorage, accountId, id).catch(() => {});
    },
    [accountId, activeBackend, engrams],
  );

  const getConversationId = useCallback(
    (engramId: number): number | null =>
      conversationMap[conversationMapKey(engramId, offlineActive)] ?? null,
    [conversationMap, offlineActive],
  );

  const setConversationId = useCallback(
    (engramId: number, conversationId: number) => {
      setConversationMap((prev) => {
        const next = {
          ...prev,
          [conversationMapKey(engramId, offlineActive)]: conversationId,
        };
        AsyncStorage.setItem(
          `${STORAGE_CONVO_MAP}.${accountId}`,
          JSON.stringify(next),
        ).catch(() => {});
        return next;
      });
    },
    [accountId, offlineActive],
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
