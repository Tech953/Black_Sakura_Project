import { useSyncExternalStore } from "react";
import { useAuth } from "@clerk/react";

export const browserTestMode =
  import.meta.env.DEV && import.meta.env.VITE_BROWSER_TEST === "true";

const initialBrowserTestUserId = "browser-test-user";
let browserTestUserId = initialBrowserTestUserId;
const listeners = new Set<() => void>();

declare global {
  var __engramBrowserTest:
    | {
        switchAccount: (userId: string) => void;
      }
    | undefined;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getBrowserTestUserId() {
  return browserTestUserId;
}

export function useBrowserTestUserId() {
  return useSyncExternalStore(
    subscribe,
    getBrowserTestUserId,
    getBrowserTestUserId,
  );
}

export function useAccountQueryId() {
  const { userId } = useAuth();
  const testUserId = useBrowserTestUserId();
  return browserTestMode ? testUserId : userId ?? null;
}

export function switchBrowserTestAccount(userId: string) {
  if (!browserTestMode) {
    throw new Error("Browser account switching is available only in the guarded test fixture.");
  }
  const nextUserId = userId.trim();
  if (!nextUserId) throw new Error("A browser test account ID is required.");
  if (nextUserId === browserTestUserId) return;
  browserTestUserId = nextUserId;
  for (const listener of listeners) listener();
}

if (browserTestMode && typeof globalThis !== "undefined") {
  globalThis.__engramBrowserTest = {
    switchAccount: switchBrowserTestAccount,
  };
}
