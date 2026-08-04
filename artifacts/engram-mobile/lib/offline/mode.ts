import AsyncStorage from "@react-native-async-storage/async-storage";
import React from "react";

/**
 * On-device (offline) mode flag.
 *
 * When enabled, every API request the app makes is served locally: data from
 * the on-device SQLite store, replies from the on-device language model.
 * The flag is persisted so the app comes back up in the same mode.
 */
const KEY = "engram.offlineMode";

let cached = false;
const listeners = new Set<(on: boolean) => void>();

/** Synchronous read of the last-loaded value (call loadOfflineMode() at startup). */
export function isOfflineMode(): boolean {
  return cached;
}

export async function loadOfflineMode(): Promise<boolean> {
  try {
    cached = (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    cached = false;
  }
  return cached;
}

export async function setOfflineMode(on: boolean): Promise<void> {
  cached = on;
  try {
    if (on) await AsyncStorage.setItem(KEY, "1");
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // persistence is best-effort; the in-memory flag still governs this session
  }
  for (const l of listeners) l(on);
}

export function subscribeOfflineMode(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React hook: re-renders when the offline mode flag changes. */
export function useOfflineMode(): boolean {
  const [on, setOn] = React.useState(cached);
  React.useEffect(() => subscribeOfflineMode(setOn), []);
  return on;
}
