import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";

export type PushRegistrationStatus =
  | "unknown"
  | "registering"
  | "registered"
  | "permission-denied"
  | "offline"
  | "failed";

export type PushRegistrationState = {
  status: PushRegistrationStatus;
  canAskAgain: boolean | null;
  updatedAt: number | null;
};

const STORAGE_KEY = "engram.pushRegistrationStatus";
const VALID_STATUSES = new Set<PushRegistrationStatus>([
  "unknown",
  "registering",
  "registered",
  "permission-denied",
  "offline",
  "failed",
]);

let state: PushRegistrationState = {
  status: "unknown",
  canAskAgain: null,
  updatedAt: null,
};
let hydration: Promise<void> | null = null;
const listeners = new Set<(value: PushRegistrationState) => void>();

function isStoredState(value: unknown): value is PushRegistrationState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PushRegistrationState>;
  return (
    typeof candidate.status === "string" &&
    VALID_STATUSES.has(candidate.status as PushRegistrationStatus) &&
    (candidate.canAskAgain === null ||
      typeof candidate.canAskAgain === "boolean") &&
    (candidate.updatedAt === null || typeof candidate.updatedAt === "number")
  );
}

function notify() {
  for (const listener of listeners) listener(state);
}

export function getPushRegistrationState(): PushRegistrationState {
  return state;
}

export function subscribePushRegistration(
  listener: (value: PushRegistrationState) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hydrates only the finite registration state. The push token is never stored
 * here, and is intentionally not part of the public state shape.
 */
export function hydratePushRegistrationStatus(): Promise<void> {
  if (hydration) return hydration;
  hydration = AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isStoredState(parsed)) return;
        state = parsed;
        notify();
      } catch {
        // A malformed status is not actionable; the next registration attempt
        // will replace it with a fresh state.
      }
    })
    .catch(() => {
      // The in-memory state still gives the Settings screen a useful status.
    });
  return hydration;
}

export function setPushRegistrationStatus(
  status: PushRegistrationStatus,
  options: { canAskAgain?: boolean | null } = {},
): void {
  state = {
    status,
    canAskAgain:
      options.canAskAgain === undefined ? null : options.canAskAgain,
    updatedAt: Date.now(),
  };
  notify();
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {
    // Persistence is best-effort; the in-memory status remains authoritative.
  });
}

/** React hook: re-renders mounted screens when registration changes. */
export function usePushRegistrationStatus(): PushRegistrationState {
  const [current, setCurrent] = React.useState(state);
  React.useEffect(() => {
    const unsubscribe = subscribePushRegistration(setCurrent);
    void hydratePushRegistrationStatus().then(() => {
      setCurrent(getPushRegistrationState());
    });
    return unsubscribe;
  }, []);
  return current;
}