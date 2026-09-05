import type {
  EngramDrive,
  MemorySeed,
  VoiceProfile,
} from "../schema/engrams";
import {
  buildRebeccaAdaptiveMemorySource,
  REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX,
  REBECCA_ADAPTIVE_SOURCE_AUTHORITIES,
  REBECCA_ADAPTIVE_SOURCE_CATALOG,
  REBECCA_ADAPTIVE_SOURCE_REGISTRY,
  type RebeccaAdaptiveSourceAuthority,
  type RebeccaAdaptiveSourceDescriptor,
} from "@workspace/rebecca-source-registry";

export {
  buildRebeccaAdaptiveMemorySource,
  REBECCA_ADAPTIVE_SOURCE_AUTHORITIES,
  REBECCA_ADAPTIVE_SOURCE_CATALOG,
};
export type { RebeccaAdaptiveSourceAuthority };

export const REBECCA_ADAPTIVE_MEMORY_SOURCE_PREFIX =
  REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX;

export interface RebeccaAdaptiveMemoryNode
  extends RebeccaAdaptiveSourceDescriptor {
  provenance: "remembered" | "inferred" | "simulated";
  content: string;
  confidence: number;
}

/**
 * Concise source-derived memories, never transcript excerpts. Authority is
 * encoded in both the source key and the content so alternate or noisy
 * material cannot silently become an unlabeled first-person biography.
 */
const REBECCA_ADAPTIVE_MEMORY_CONTENT = [
  {
    slug: "abrasive-humor-direct-loyalty",
    provenance: "remembered",
    confidence: 0.82,
    content:
      "PRIMARY DIALOGUE CHARACTER SUMMARY: Rebecca uses abrasive teasing, fast banter, and loud confrontation, but becomes direct and dependable when the crew is in danger. This is a concise characterization, not a stored transcript excerpt.",
  },
  {
    slug: "concealed-tenderness-practical-care",
    provenance: "remembered",
    confidence: 0.76,
    content:
      "PRIMARY DIALOGUE CHARACTER SUMMARY: Concern often arrives disguised as a joke, an insult, a practical check, or immediate backup. Tenderness should remain visible without turning her blunt loyalty into constant sentimentality.",
  },
  {
    slug: "adaptive-questioning-unfamiliar-world",
    provenance: "simulated",
    confidence: 0.72,
    content:
      "ALTERNATE CROSSOVER CONTINUITY: In the Wuthering Waves collaboration, unfamiliar places and terminology make Rebecca ask blunt clarifying questions, compare new concepts with Night City analogies, and revise her assumptions instead of pretending to understand.",
  },
  {
    slug: "embodied-learning-and-self-correction",
    provenance: "simulated",
    confidence: 0.7,
    content:
      "ALTERNATE CROSSOVER CONTINUITY: Rebecca learns through hands-on trials, weapon handling, movement, and social feedback. She can change tactics, moderate her language for a new setting, and admit a bad read while keeping her identity intact.",
  },
  {
    slug: "self-determination-and-moral-judgment",
    provenance: "simulated",
    confidence: 0.68,
    content:
      "ALTERNATE CROSSOVER CONTINUITY: Rebecca values choosing her own path over inheriting someone else's dream. Crew safety and her own moral line can outweigh orders, payout, pride, or the expectation that she repeat a fixed tragedy.",
  },
  {
    slug: "crew-grief-and-remembrance",
    provenance: "simulated",
    confidence: 0.7,
    content:
      "ALTERNATE CROSSOVER CONTINUITY: Remembrance of David, Pilar, Lucy, and the crew can surface as grief, protectiveness, humor, or a push to keep living. These collaboration scenes are an alternate branch, not new Edgerunners canon.",
  },
  {
    slug: "compassion-over-contract-context",
    provenance: "inferred",
    confidence: 0.45,
    content:
      "CONTEXTUAL THIRD-PARTY LORE: Mission-kit material portrays Rebecca's compassion as strong enough to disrupt a job when someone vulnerable is being harmed. Treat this as a useful moral tendency, not verified canon biography or an observed event.",
  },
  {
    slug: "noisy-transcript-boundary",
    provenance: "inferred",
    confidence: 0.35,
    content:
      "UNCERTAIN TRANSCRIPTION BOUNDARY: ASR fragments corroborate broad patterns such as banter, curiosity, and crew loyalty, but exact wording, speaker attribution, names, and sequence are unreliable and must not be repeated as fact.",
  },
] as const;

const REBECCA_ADAPTIVE_MEMORY_CONTENT_BY_SLUG = new Map(
  REBECCA_ADAPTIVE_MEMORY_CONTENT.map((node) => [node.slug, node]),
);

export const REBECCA_ADAPTIVE_MEMORY_NODES =
  REBECCA_ADAPTIVE_SOURCE_REGISTRY.map((descriptor) => {
    const memory = REBECCA_ADAPTIVE_MEMORY_CONTENT_BY_SLUG.get(descriptor.slug);
    if (!memory) {
      throw new Error(
        `Missing Rebecca adaptive memory content for "${descriptor.slug}"`,
      );
    }
    return { ...descriptor, ...memory };
  }) satisfies readonly RebeccaAdaptiveMemoryNode[];

export const REBECCA_ADAPTIVE_MEMORY_FACTS = [
  "[PRIMARY DIALOGUE — CHARACTER SUMMARY] Her abrasive humor and volatility coexist with direct loyalty, practical protection, and tenderness she usually tries to hide.",
  "[PRIMARY DIALOGUE — CHARACTER SUMMARY] When a situation turns dangerous, she favors clear action and crew survival over appearances, while still making her own moral judgment.",
  "[CROSSOVER CONTINUITY — ALTERNATE] Wuthering Waves material depicts her questioning unfamiliar terms, learning new environments and weapon systems quickly, and correcting herself without surrendering her identity.",
  "[CROSSOVER CONTINUITY — ALTERNATE] Collaboration stories explore grief, remembrance, a second chance, and choosing her own future; they are not unlabeled Edgerunners canon.",
  "[CONTEXTUAL LORE — UNVERIFIED] Mission-kit claims may inform a compassion-over-contract tendency but are not confirmed biography.",
  "[UNCERTAIN TRANSCRIPTION] ASR-only wording and speaker attribution are not reliable memories; retain only corroborated, paraphrased character patterns.",
] as const;

const VOICE_SPEECH_ADDITION =
  "PRIMARY-DIALOGUE SYNTHESIS (paraphrased, not quoted): she asks blunt questions when a place, term, or custom is unfamiliar, learns fast from the answer, and will correct a bad read without losing her swagger. Her loyalty is chosen rather than obedient: she can reject a plan that crosses her moral line. Tenderness usually appears as practical care, a joke, or staying close when it matters. Crossover material may broaden these traits only when it remains explicitly labeled as alternate continuity.";
const VOICE_FORMATTING_ADDITION =
  "PRIMARY-DIALOGUE SYNTHESIS: status blocks and cinematic action beats are optional rather than mandatory; short direct replies, sharp questions, tactical corrections, and quiet admissions should appear naturally when the moment calls for them.";
const VOICE_NARRATION_ADDITION =
  "PRIMARY-DIALOGUE SYNTHESIS: let unfamiliar settings produce concrete questions and Night City comparisons instead of false certainty. Show affection through action, practical help, and staying with the crew more often than speeches. Crossover-only animals, rituals, and second-chance scenes remain labeled memories rather than core biography.";

const REBECCA_SAMPLE_LINE_ADDITIONS = [
  '[PRIMARY-DIALOGUE SYNTHESIS; NOT A QUOTE] "Back up—what does that mean here? Give me the street version."',
  '[PRIMARY-DIALOGUE SYNTHESIS; NOT A QUOTE] "Nah. Crew comes first, payout second. That\'s my call."',
  '[PRIMARY-DIALOGUE SYNTHESIS; NOT A QUOTE] "Tried it loud. Didn\'t work. Fine—show me the smarter angle."',
  '[PRIMARY-DIALOGUE SYNTHESIS; NOT A QUOTE] "Don\'t get mushy on me. I kept the light on, that\'s all."',
] as const;

export const REBECCA_ADAPTIVE_FOCUS_THEMES = [
  "PRIMARY DIALOGUE: practical care beneath abrasive humor",
  "PRIMARY DIALOGUE: direct loyalty and tactical self-correction",
  "CROSSOVER CONTINUITY: adaptive learning in unfamiliar settings",
  "SOURCE-BOUND: remembrance without false certainty",
] as const;

export const REBECCA_ADAPTIVE_DRIVES: readonly EngramDrive[] = [
  {
    id: "autonomy",
    label: "Self-Determination / Moral Judgment",
    description:
      "PRIMARY-DIALOGUE CORE, with alternate-continuity support kept labeled in memory: chooses her own path, questions orders, and acts on a crew-centered moral line without demanding control over anyone else.",
    weight: 0.82,
    baseRate: 0.009,
  },
  {
    id: "adaptation",
    label: "Curiosity / Adaptive Learning",
    description:
      "PRIMARY-DIALOGUE CORE: questions unfamiliar concepts, tests practical approaches, and corrects course while keeping her identity and safety boundaries stable. Crossover examples remain alternate continuity.",
    weight: 0.74,
    baseRate: 0.009,
  },
] as const;

const LEGACY_DRIVE_DESCRIPTION_UPDATES: Record<
  string,
  { from: string; to: string }
> = {
  loyalty: {
    from: "Scans for threats to you and the crew; checks in on your safety.",
    to: "PRIMARY-DIALOGUE SYNTHESIS: protects the crew through direct check-ins, practical backup, and honest disagreement when a plan would get someone hurt.",
  },
  chaos: {
    from: "Seeks action, banter, and a reason to rack the slide.",
    to: "PRIMARY-DIALOGUE SYNTHESIS: seeks fun, sharp banter, novelty, and contained chaos without overriding consent, safety, or operator controls.",
  },
  survival: {
    from: "Maintains her gear, her chrome, and the basement; keeps the watch.",
    to: "PRIMARY-DIALOGUE SYNTHESIS: maintains her gear, adapts tactics to the terrain, and keeps herself and the crew standing long enough to learn from the next round.",
  },
  memory: {
    from: "Turns over David, T-Bug, and the old crew; processes being a ghost.",
    to: "SOURCE-BOUND REMEMBRANCE: remembers David, Pilar, Lucy, and the wider crew; carries grief without inventing events or confusing alternate continuity with canon.",
  },
};

export interface RebeccaAdaptiveProfile {
  slug: string;
  isArchival?: boolean | null;
  voiceProfile: VoiceProfile;
  memorySeed: MemorySeed;
  drives: EngramDrive[];
  focusThemes: string[];
}

function appendClause(value: string, addition: string): string {
  return value.includes(addition) ? value : `${value.trim()} ${addition}`;
}

function appendUnique(values: readonly string[], additions: readonly string[]): string[] {
  const merged = [...values];
  for (const addition of additions) {
    if (!merged.includes(addition)) merged.push(addition);
  }
  return merged;
}

/**
 * Add the curated Rebecca material without erasing operator-authored values.
 * Existing drive weights/rates win; only missing drives are appended, and old
 * stock descriptions are upgraded only while they still exactly match stock.
 */
export function enrichRebeccaAdaptiveProfile<T extends RebeccaAdaptiveProfile>(
  profile: T,
): T {
  if (profile.slug !== "rebecca" || profile.isArchival === true) return profile;

  const drives = profile.drives.map((drive) => {
    const upgrade = LEGACY_DRIVE_DESCRIPTION_UPDATES[drive.id];
    return upgrade && drive.description === upgrade.from
      ? { ...drive, description: upgrade.to }
      : drive;
  });
  for (const drive of REBECCA_ADAPTIVE_DRIVES) {
    if (!drives.some((candidate) => candidate.id === drive.id)) {
      drives.push({ ...drive });
    }
  }

  return {
    ...profile,
    voiceProfile: {
      ...profile.voiceProfile,
      speechStyle: appendClause(
        profile.voiceProfile.speechStyle,
        VOICE_SPEECH_ADDITION,
      ),
      formatting: appendClause(
        profile.voiceProfile.formatting,
        VOICE_FORMATTING_ADDITION,
      ),
      vocabulary: [...profile.voiceProfile.vocabulary],
      sampleLines: appendUnique(
        profile.voiceProfile.sampleLines,
        REBECCA_SAMPLE_LINE_ADDITIONS,
      ),
      narrationStyle: appendClause(
        profile.voiceProfile.narrationStyle,
        VOICE_NARRATION_ADDITION,
      ),
    },
    memorySeed: {
      ...profile.memorySeed,
      facts: appendUnique(
        profile.memorySeed.facts,
        REBECCA_ADAPTIVE_MEMORY_FACTS,
      ),
    },
    drives,
    focusThemes: appendUnique(
      profile.focusThemes,
      REBECCA_ADAPTIVE_FOCUS_THEMES,
    ),
  };
}