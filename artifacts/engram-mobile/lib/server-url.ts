import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Persisted server address override.
 *
 * By default the app talks to the server baked in at build time
 * (EXPO_PUBLIC_DOMAIN). Users running the ENGRAM desktop app can point the
 * mobile app at it over LAN (e.g. http://192.168.1.20:3101) so everything
 * works fully offline against the desktop's embedded server.
 */
const KEY = "engram.serverUrl";

export const DEFAULT_SERVER_URL = `https://${process.env.EXPO_PUBLIC_DOMAIN}`;

export function normalizeServerUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  try {
    // Constrain to an http(s) origin — no path, query, or credentials — so
    // the persisted value is always a clean base URL.
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Returns the stored override, or null when using the built-in default. */
export async function getServerUrlOverride(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setServerUrlOverride(url: string | null): Promise<void> {
  if (url) {
    await AsyncStorage.setItem(KEY, url);
  } else {
    await AsyncStorage.removeItem(KEY);
  }
}

/** The URL the app should actually use right now. */
export async function resolveServerUrl(): Promise<string> {
  return (await getServerUrlOverride()) ?? DEFAULT_SERVER_URL;
}
