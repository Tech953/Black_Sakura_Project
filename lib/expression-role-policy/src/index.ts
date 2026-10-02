export const NEUTRAL_EXPRESSION_ROLE_VALUES = [
  "alarm",
  "attention",
  "baseline",
  "bonding",
  "conflict-monitor",
  "distress",
  "error-signal",
  "fatigue",
  "incentive",
  "orienting",
  "overload",
  "rapport",
  "reward-signal",
  "salience-spike",
  "social-signal",
  "surrender",
] as const;

export type NeutralExpressionRole =
  (typeof NEUTRAL_EXPRESSION_ROLE_VALUES)[number];

/** Neutral roles that may be included in prompt-facing expression metadata. */
export const NEUTRAL_EXPRESSION_ROLES: ReadonlySet<string> = new Set(
  NEUTRAL_EXPRESSION_ROLE_VALUES,
);

/**
 * Curated seeds retain this existing intimate classification for catalog fidelity.
 * It is deliberately excluded from ordinary expression insert/update validation.
 */
export const STORED_ONLY_EXPRESSION_ROLE_VALUES = ["attachment"] as const;

/** Roles accepted by the trusted reference-data seed schema. */
export const SEED_EXPRESSION_ROLE_VALUES = [
  ...NEUTRAL_EXPRESSION_ROLE_VALUES,
  ...STORED_ONLY_EXPRESSION_ROLE_VALUES,
] as const;

export function normalizeExpressionRole(
  role?: string | null,
): NeutralExpressionRole | null {
  const normalized = role?.trim().toLowerCase();
  return normalized && NEUTRAL_EXPRESSION_ROLES.has(normalized)
    ? (normalized as NeutralExpressionRole)
    : null;
}