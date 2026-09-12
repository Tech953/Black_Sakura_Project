type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

/**
 * Replit injects Umami only for an enabled, published website.
 * Keep analytics optional so development, previews, and disabled deployments
 * never affect product behavior.
 */
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (import.meta.env.DEV || typeof window === "undefined") return;

  try {
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
}