export function configuredCorsOrigins(
  raw = process.env.CORS_ALLOWED_ORIGINS,
): ReadonlySet<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((origin) => origin.trim().replace(/\/+$/, ""))
      .filter(Boolean),
  );
}

/**
 * Browser clients use the API through the same Replit/deployment host. A
 * comma-separated allowlist supports intentionally separate first-party web
 * deployments without ever reflecting an arbitrary credentialed origin.
 * Native clients normally omit Origin and are unaffected.
 */
export function isAllowedCorsOrigin(
  origin: string | undefined,
  requestHost: string | undefined,
  allowedOrigins = configuredCorsOrigins(),
): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/+$/, "");
  if (allowedOrigins.has(normalized)) return true;
  if (!requestHost) return false;
  try {
    const parsed = new URL(normalized);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.host === requestHost
    );
  } catch {
    return false;
  }
}