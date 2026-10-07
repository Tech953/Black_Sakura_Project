import { useSyncExternalStore } from "react";

/**
 * Development-only authentication state for the local release regression.
 *
 * This is intentionally controlled by an explicit environment flag so normal
 * development and every production/native build still use Clerk unchanged.
 */
export const e2eAuthBypass =
  typeof __DEV__ !== "undefined" &&
  __DEV__ &&
  process.env.EXPO_PUBLIC_E2E_AUTH_BYPASS === "true";

export const e2eAuthUserId = "e2e-history-user";

let activeE2EAuthUserId = e2eAuthUserId;
const listeners = new Set<() => void>();

declare global {
  var __engramE2EAuth:
    | {
        switchUser: (userId: string) => void;
        getUserId: () => string;
      }
    | undefined;
}

function subscribeToE2EAuthUser(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getE2EAuthUserId() {
  return activeE2EAuthUserId;
}

export function useE2EAuthUserId() {
  return useSyncExternalStore(
    subscribeToE2EAuthUser,
    getE2EAuthUserId,
    getE2EAuthUserId,
  );
}

export function switchE2EAuthUser(userId: string) {
  if (!e2eAuthBypass) {
    throw new Error("The E2E account switch is available only in the guarded browser fixture.");
  }
  const nextUserId = userId.trim();
  if (!nextUserId) throw new Error("An E2E account ID is required.");
  if (nextUserId === activeE2EAuthUserId) return;
  activeE2EAuthUserId = nextUserId;
  for (const listener of listeners) listener();
}

if (e2eAuthBypass && typeof globalThis !== "undefined") {
  globalThis.__engramE2EAuth = {
    switchUser: switchE2EAuthUser,
    getUserId: getE2EAuthUserId,
  };
}