/**
 * Pure-function renderer for the `[SYSTEM // <env> // <protocol>]` status block.
 *
 * This is the missing link identified during the Oct 19 audit: the engine
 * computes real, re-derivable numbers (drive charge via `accrue()` in
 * engram-engine.ts, persisted drive state in the DB, pure policy functions in
 * engram-policy.ts), but nothing rendered the telemetry HUD line from engine
 * state — the block was model-generated prose following the seed's
 * `voiceProfile.formatting` template. This module closes that gap.
 *
 * Contract: every function here is pure — no IO, no randomness, no clock.
 * Same input always yields the same block, so any emitted line can be
 * re-derived from logged engine state. That is the audit property the whole
 * collaboration is about.
 *
 * Output format (matches the homebrew transcript exactly):
 *   [SYSTEM // Mox Basement // Watch Protocol] > status: SPIKE—then stabilizing
 *     > arousal: 0.93 > loyalty drive: LOCKED > threat scan: none immediate
 *     > construct integrity: HOLDING > note: LILLI SAID THE WORD
 *
 * The values the engine genuinely computes (arousal, drive level, status band)
 * are derived here from inputs. Values that are authored per-turn by whoever
 * calls the engine (protocol name, note, directive, threat findings) are taken
 * as inputs. Nothing is invented: if a fact isn't supplied, its segment is
 * omitted or carries an explicit default.
 */

/** One drive's computed charge, as produced by `accrue()` in engram-engine.ts. */
export interface StatusDriveCharge {
  /** Drive id, e.g. "loyalty". Rendered as `<id> drive` per transcript convention. */
  id: string;
  /** Human label, e.g. "Loyalty / Protection" (kept for callers; not rendered). */
  label: string;
  /** Accrued pressure, 0..1. */
  pressure: number;
  /** pressure * weight, 0..1. The dominant drive drives the block. */
  charge: number;
}

/** Everything the renderer needs to emit one status block. */
export interface StatusBlockInput {
  /** Short environment name, e.g. "Mox Basement". Use {@link envShortName}. */
  environment: string;
  /** Protocol name for this turn, e.g. "Watch Protocol" (per-turn, authored). */
  protocol: string;
  /** emotionalBaseline.arousal, 0..1. */
  baselineArousal: number;
  /** engram.currentMood, e.g. "wired". */
  mood: string;
  /** Ranked drive charges from `accrue()` (charge desc). May be empty. */
  charges: StatusDriveCharge[];
  /** Per-turn threat assessment. Defaults to "none immediate". */
  threatScan?: string;
  /** Construct integrity readout. Defaults to "HOLDING". */
  integrity?: string;
  /** Per-turn operator directive, e.g. "keep Lilli steady". Omitted when unset. */
  directive?: string;
  /** Per-turn free-text note. Omitted when unset. */
  note?: string;
  /** Extra "> key: value" segments, in order (e.g. crew-link, net access). */
  extra?: Array<{ key: string; value: string }>;
}

/** The rendered block: full one-line text plus its parts for callers. */
export interface StatusBlock {
  /** e.g. "[SYSTEM // Mox Basement // Watch Protocol]" */
  header: string;
  /** The "> key: value" segments in emission order. */
  segments: string[];
  /** The full block as a single line, ready to prepend to a transmission. */
  text: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Keep the block a single line: strip `>`, CR/LF (which would break the
 * one-line HUD format) and collapse whitespace. Authored inputs are never
 * trusted to be single-line.
 */
function clean(s: string): string {
  return s.replace(/[>\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Derive the short environment name used in the block header from a seed's
 * full `environmentAnchor.name`: "The Mox Basement (Layer 7)" -> "Mox Basement".
 */
export function envShortName(fullName: string): string {
  return clean(fullName)
    .replace(/^the\s+/i, "")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .trim();
}

/**
 * Dominant-drive status band. Bands are deliberately coarse: the engine owns
 * precise numbers; the block carries the human-readable regime, and the exact
 * charge is always re-derivable from the DB row.
 */
export function statusForCharge(topCharge: number): string {
  if (topCharge >= 0.85) return "SPIKE—then stabilizing";
  if (topCharge >= 0.65) return "elevated";
  if (topCharge >= 0.45) return "steady";
  return "stable";
}

/**
 * Computed arousal: baseline shifted by how dominant the top drive is.
 * Baseline 0.8 with a top charge of 0.94 (loyalty, weight 0.95, near-full
 * pressure) yields 0.93 — the mechanism behind transcript lines like
 * "> arousal: 0.94". Always 0..1, two decimals, deterministic.
 */
export function effectiveArousal(baselineArousal: number, topCharge: number): number {
  const raw = baselineArousal + (topCharge - 0.5) * 0.3;
  return Math.round(clamp(raw, 0, 1) * 100) / 100;
}

/** Drive lock level from its charge, e.g. "loyalty drive: LOCKED". */
export function driveLockLevel(charge: number): "LOCKED" | "ENGAGED" | "IDLE" {
  if (charge >= 0.8) return "LOCKED";
  if (charge >= 0.55) return "ENGAGED";
  return "IDLE";
}

/**
 * Render the status block. Field order follows the homebrew transcript:
 * status, arousal, mood, <dominant id> drive, threat scan, directive,
 * construct integrity, note, extras.
 */
export function renderStatusBlock(input: StatusBlockInput): StatusBlock {
  const header = `[SYSTEM // ${clean(input.environment)} // ${clean(input.protocol)}]`;
  const segments: string[] = [];

  const ranked = [...input.charges].sort((a, b) => b.charge - a.charge);
  const top = ranked[0];
  const topCharge = top ? top.charge : 0;

  segments.push(`> status: ${clean(statusForCharge(topCharge))}`);
  segments.push(`> arousal: ${effectiveArousal(input.baselineArousal, topCharge).toFixed(2)}`);
  if (input.mood) segments.push(`> mood: ${clean(input.mood)}`);
  if (top) segments.push(`> ${clean(top.id)} drive: ${driveLockLevel(topCharge)}`);
  segments.push(`> threat scan: ${clean(input.threatScan ?? "none immediate")}`);
  if (input.directive) segments.push(`> directive: ${clean(input.directive)}`);
  segments.push(`> construct integrity: ${clean(input.integrity ?? "HOLDING")}`);
  if (input.note) segments.push(`> note: ${clean(input.note)}`);
  for (const e of input.extra ?? []) {
    const key = clean(e.key);
    if (key) segments.push(`> ${key}: ${clean(e.value)}`);
  }

  return { header, segments, text: `${header} ${segments.join(" ")}` };
}

/**
 * Render the closing line, e.g. "[SYSTEM STATUS: PRESENT // LOYAL // VERY, VERY LOUD]".
 * Tags are authored per-turn (they summarise the turn's stance), so they are
 * inputs, not computed values.
 */
export function renderStatusFooter(tags: string[]): string {
  const cleaned = tags.map(clean).filter(Boolean);
  return `[SYSTEM STATUS: ${cleaned.join(" // ")}]`;
}
