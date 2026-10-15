/**
 * Dependency-free trust registry for Rebecca's curated adaptive source data.
 *
 * Keep characterization content in the seed package. This module owns only the
 * identities and codec that form the security boundary shared by seeding,
 * prompt ranking, API namespace protection, and mobile reconciliation.
 */
export const REBECCA_ADAPTIVE_SOURCE_AUTHORITIES = [
  "primary-dialogue",
  "crossover-continuity",
  "contextual-lore",
  "uncertain-transcription",
] as const;

export type RebeccaAdaptiveSourceAuthority =
  (typeof REBECCA_ADAPTIVE_SOURCE_AUTHORITIES)[number];

export const REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX =
  "seed:rebecca-adaptive:v1:";

export const REBECCA_ADAPTIVE_SOURCE_CATALOG = [
  {
    id: "edgerunners-dialogue-asr",
    authority: "primary-dialogue",
    fidelity: "uncertain-transcription",
    use:
      "Broad voice, banter, loyalty, and combat-response patterns only; no exact wording or uncertain speaker attribution.",
  },
  {
    id: "edgerunners-mission-kit-lore",
    authority: "contextual-lore",
    fidelity: "third-party-summary",
    use:
      "Compassion-over-contract context only; family and campaign claims remain unverified.",
  },
  {
    id: "wuthering-waves-crossover-compilation-asr",
    authority: "crossover-continuity",
    fidelity: "uncertain-transcription",
    use:
      "Alternate-continuity curiosity, learning, remembrance, and second-chance themes; malformed names and sequence are discarded.",
  },
  {
    id: "wuthering-waves-voice-lines",
    authority: "crossover-continuity",
    fidelity: "structured-localization",
    use:
      "Alternate-continuity voice range, social adaptation, survival learning, crew relationships, and interests.",
  },
  {
    id: "wuthering-waves-kit-lore",
    authority: "crossover-continuity",
    fidelity: "structured-lore",
    use:
      "Alternate-continuity item, weapon-adaptation, tenderness, and remembrance themes; crossover mechanics stay quarantined.",
  },
  {
    id: "wuthering-waves-character-lore",
    authority: "crossover-continuity",
    fidelity: "structured-lore",
    use:
      "Alternate-continuity autonomy, moral judgment, crew protection, and grief; not promoted to Edgerunners canon.",
  },
] as const;

export type RebeccaAdaptiveSourceId =
  (typeof REBECCA_ADAPTIVE_SOURCE_CATALOG)[number]["id"];

export interface RebeccaAdaptiveSourceDescriptor {
  slug: string;
  authority: RebeccaAdaptiveSourceAuthority;
  sourceIds: readonly RebeccaAdaptiveSourceId[];
}

export const REBECCA_ADAPTIVE_SOURCE_REGISTRY = [
  {
    slug: "abrasive-humor-direct-loyalty",
    authority: "primary-dialogue",
    sourceIds: ["edgerunners-dialogue-asr"],
  },
  {
    slug: "concealed-tenderness-practical-care",
    authority: "primary-dialogue",
    sourceIds: ["edgerunners-dialogue-asr"],
  },
  {
    slug: "adaptive-questioning-unfamiliar-world",
    authority: "crossover-continuity",
    sourceIds: [
      "wuthering-waves-crossover-compilation-asr",
      "wuthering-waves-voice-lines",
    ],
  },
  {
    slug: "embodied-learning-and-self-correction",
    authority: "crossover-continuity",
    sourceIds: ["wuthering-waves-voice-lines", "wuthering-waves-kit-lore"],
  },
  {
    slug: "self-determination-and-moral-judgment",
    authority: "crossover-continuity",
    sourceIds: [
      "wuthering-waves-character-lore",
      "wuthering-waves-voice-lines",
    ],
  },
  {
    slug: "crew-grief-and-remembrance",
    authority: "crossover-continuity",
    sourceIds: [
      "wuthering-waves-character-lore",
      "wuthering-waves-crossover-compilation-asr",
    ],
  },
  {
    slug: "compassion-over-contract-context",
    authority: "contextual-lore",
    sourceIds: ["edgerunners-mission-kit-lore"],
  },
  {
    slug: "noisy-transcript-boundary",
    authority: "uncertain-transcription",
    sourceIds: [
      "edgerunners-dialogue-asr",
      "wuthering-waves-crossover-compilation-asr",
    ],
  },
] as const satisfies readonly RebeccaAdaptiveSourceDescriptor[];

export function buildRebeccaAdaptiveMemorySource(
  descriptor: RebeccaAdaptiveSourceDescriptor,
): string {
  return (
    `${REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX}${descriptor.authority}:` +
    `${descriptor.sourceIds.join("+")}:${descriptor.slug}`
  );
}

export const TRUSTED_REBECCA_ADAPTIVE_SOURCES =
  REBECCA_ADAPTIVE_SOURCE_REGISTRY.map(
    buildRebeccaAdaptiveMemorySource,
  ) as readonly string[];

const TRUSTED_SOURCE_SET = new Set<string>(
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
);

export interface ParsedRebeccaAdaptiveSource {
  authority: RebeccaAdaptiveSourceAuthority;
  sourceIds: RebeccaAdaptiveSourceId[];
}

export function parseRebeccaAdaptiveSource(
  source: string | null | undefined,
): ParsedRebeccaAdaptiveSource | null {
  if (!source || !TRUSTED_SOURCE_SET.has(source)) return null;
  const [authority, sourceIds] = source
    .slice(REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX.length)
    .split(":");
  return {
    authority: authority as RebeccaAdaptiveSourceAuthority,
    sourceIds: sourceIds.split("+") as RebeccaAdaptiveSourceId[],
  };
}

export function isReservedRebeccaAdaptiveSource(
  source: string | null | undefined,
): boolean {
  return Boolean(source?.startsWith(REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX));
}