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