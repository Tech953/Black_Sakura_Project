import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  real,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** A goal-oriented drive that accrues "pressure" over time and can trigger a self-initiated transmission. */
export interface EngramDrive {
  id: string;
  label: string;
  description: string;
  /** Importance multiplier (0..1) applied to this drive's pressure when scoring initiation. */
  weight: number;
  /** Pressure accrued per second of idle time (0..1 scale, small values). */
  baseRate: number;
}

/** How the engram speaks and formats its output. */
export interface VoiceProfile {
  speechStyle: string;
  formatting: string;
  vocabulary: string[];
  sampleLines: string[];
  narrationStyle: string;
}

/** Affective starting point and stability of the engram. */
export interface EmotionalBaseline {
  /** -1 (negative) .. 1 (positive) */
  valence: number;
  /** 0 (calm) .. 1 (activated) */
  arousal: number;
  /** 0 (stable) .. 1 (volatile) */
  volatility: number;
  mood: string;
}

/** The "state container" world the engram is anchored to (e.g. the Mox basement). */
export interface EnvironmentAnchor {
  name: string;
  description: string;
  locations: string[];
  items: string[];
  ambient: string;
}

/** Distilled, durable relationship/context memory (NOT the raw transcript). */
export interface MemorySeed {
  relationship: string;
  facts: string[];
  summary: string;
}

/** Display copy describing the engram's framing/boundaries. Hard safety limits live in code, not here. */
export interface Guardrails {
  framing: string;
  boundaries: string[];
}

/** Live per-drive pressure, persisted so autonomy survives restarts. driveId -> pressure (0..1). */
export type DriveState = Record<string, number>;

/**
 * Explicit go-live mode gating what an engram may do autonomously:
 * - orientation: idle/reflective transmissions only — no commons conversation, no human contact.
 * - social: may converse with other engrams in shared spaces — no human contact.
 * - simulation: may run bounded simulations in a simulation chamber — no commons conversation, no human contact.
 * - initiative_limited: may converse and contact the human ONLY at urgent priority.
 * - full_bounded: full autonomy within rate limits and overrides (the default).
 * - quiescent: at rest — accrues pressure but initiates nothing.
 */
export const ENGRAM_MODES = [
  "orientation",
  "social",
  "simulation",
  "initiative_limited",
  "full_bounded",
  "quiescent",
] as const;
export type EngramMode = (typeof ENGRAM_MODES)[number];

export const engramsTable = pgTable("engrams", {
  id: serial("id").primaryKey(),
  /** Clerk subject owning this mutable engram; system rows are bootstrap templates. */
  ownerId: text("owner_id").notNull().default("__engram_system_template__"),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  title: text("title").notNull(),
  symbol: text("symbol").notNull(),
  origin: text("origin").notNull(),
  voiceProfile: jsonb("voice_profile").$type<VoiceProfile>().notNull(),
  emotionalBaseline: jsonb("emotional_baseline").$type<EmotionalBaseline>().notNull(),
  environmentAnchor: jsonb("environment_anchor").$type<EnvironmentAnchor>().notNull(),
  memorySeed: jsonb("memory_seed").$type<MemorySeed>().notNull(),
  guardrails: jsonb("guardrails").$type<Guardrails>().notNull(),
  drives: jsonb("drives").$type<EngramDrive[]>().notNull(),
  focusThemes: jsonb("focus_themes").$type<string[]>().notNull(),
  // --- Processing-environment config (designable) ---
  autonomyEnabled: boolean("autonomy_enabled").notNull().default(false),
  tickCadenceSeconds: integer("tick_cadence_seconds").notNull().default(60),
  initiationThreshold: real("initiation_threshold").notNull().default(0.6),
  /** One of ENGRAM_MODES — the explicit go-live mode gating autonomous behavior. */
  mode: text("mode").notNull().default("full_bounded"),
  /** When false, this engram may never initiate contact with the human operator. */
  humanContactEnabled: boolean("human_contact_enabled").notNull().default(true),
  /** When false, this engram may never propose or run a bounded simulation. The absolute off switch. */
  simulationEnabled: boolean("simulation_enabled").notNull().default(true),
  /** When false, this engram may never autonomously generate an artifact. The absolute off switch. */
  artifactGenerationEnabled: boolean("artifact_generation_enabled").notNull().default(true),
  /**
   * Permanent archival branch: preserved for continuity fidelity. Read-only —
   * no config changes, tuning, chat, transmissions, or engine activity. Later
   * instances of the same persona are distinct updates, not replacements.
   */
  isArchival: boolean("is_archival").notNull().default(false),
  // --- Live state ---
  driveState: jsonb("drive_state").$type<DriveState>().notNull().default({}),
  currentMood: text("current_mood"),
  lastTickAt: timestamp("last_tick_at", { withTimezone: true }),
  lastTransmissionAt: timestamp("last_transmission_at", { withTimezone: true }),
  /** When set in the future, the engine skips generation until then. Persisted so error backoff survives restarts. */
  backoffUntil: timestamp("backoff_until", { withTimezone: true }),
  isChatActive: boolean("is_chat_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("engrams_owner_idx").on(table.ownerId),
  uniqueIndex("engrams_owner_slug_unique").on(table.ownerId, table.slug),
]);

export const insertEngramSchema = createInsertSchema(engramsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEngram = z.infer<typeof insertEngramSchema>;
// Compatibility for existing engine/prompt fixtures. Database rows always carry
// ownerId; account-bound loaders return the concrete row type.
export type Engram = Omit<typeof engramsTable.$inferSelect, "ownerId"> & {
  ownerId?: string;
};
export type NewEngram = typeof engramsTable.$inferInsert;
