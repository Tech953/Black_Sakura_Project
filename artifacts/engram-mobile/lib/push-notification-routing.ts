import type { NotificationResponse } from "expo-notifications";

export const MOBILE_FEED_ROUTE = "/(tabs)/feed" as const;

export type NotificationResponseHandlers = {
  selectEngram: (engramId: number) => void;
  replace: (route: typeof MOBILE_FEED_ROUTE) => void;
};

export function transmissionEngramId(
  response: NotificationResponse | null | undefined,
): number | null {
  const value = response?.notification?.request?.content?.data?.engramId;
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Applies the same routing behavior to foreground taps and cold-start taps.
 * Invalid notification payloads are intentionally ignored.
 */
export function handleNotificationResponse(
  response: NotificationResponse | null | undefined,
  handlers: NotificationResponseHandlers,
): boolean {
  const engramId = transmissionEngramId(response);
  if (!engramId) return false;
  handlers.selectEngram(engramId);
  handlers.replace(MOBILE_FEED_ROUTE);
  return true;
}

/**
 * Reads and routes the response that launched the app. Keeping the async
 * lookup here makes the cold-start path independently testable.
 */
export async function handleLastNotificationResponse(
  getLastNotificationResponse: () => Promise<NotificationResponse | null>,
  handlers: NotificationResponseHandlers,
): Promise<boolean> {
  const response = await getLastNotificationResponse();
  return handleNotificationResponse(response, handlers);
}