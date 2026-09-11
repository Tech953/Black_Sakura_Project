import { db } from "@workspace/db";
import { engramsTable, engramTransmissionsTable, SYSTEM_OWNER_ID } from "@workspace/db/schema";
import type {
  Engram,
  EngramTransmission,
  DriveState,
  HubSpace,
  EngramPresence,
} from "@workspace/db";
import { and, desc, eq, gte, inArray, ne } from "drizzle-orm";
import { logger } from "../lib/logger";
import { generateTransmission, type TransmissionKind } from "../lib/engram-generation";
import { summarizeWorldModel } from "../lib/world-model";
import { loadRecentWorldModel, appendWorldModelEntry } from "../lib/world-model-store";
import { loadSpaces, loadPresence, loadPresenceForEngram, loadSpaceById } from "../lib/hub-store";
import { capabilitiesFor, type Capabilities } from "../lib/engram-policy";
import { loadControls } from "../lib/controls-store";
import { attemptOperatorContact } from "../lib/operator-contact";
import { maybeRunCommonsTurn } from "../lib/commons";
import { maybeRunSimulationStep } from "../lib/simulations";
import { maybeRunArtifactGeneration } from "../lib/artifacts-scheduler";
import { normalizeLLMProviderError } from "../lib/llm";

// --- Tunable constants (cost & cadence guards) ---
const GLOBAL_TICK_MS = 20_000; // how often the engine wakes up
export const COOLDOWN_MS = 90_000; // minimum gap between an engram's transmissions
export const HOURLY_CAP = 10; // max transmissions per engram per rolling hour
export const DAILY_CAP = 60; // max transmissions per engram per rolling day
export const MAX_ELAPSED_SEC = 600; // cap accrual after long downtime / clock jumps
const ERROR_BACKOFF_MS = 120_000; // skip generation for an engram after a failure

const OUTREACH_HINT = /(connection|devotion|loyal|protect|chaos|fun|reach|company)/i;

let ticking = false; // re-entrancy guard for a single tick
let started = false; // lifecycle guard so the engine only starts once
let timer: NodeJS.Timeout | null = null;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function pickKind(driveId: string, label: string): TransmissionKind {
  return OUTREACH_HINT.test(`${driveId} ${label}`) ? "outreach" : "idle";
}

export interface DriveCharge {
  id: string;
  label: string;
  description: string;
  pressure: number;
  charge: number; // pressure * weight
}

/** Accrue per-drive pressure from elapsed time (no LLM). Returns the new state + ranked charges. */
export function accrue(
  engram: Engram,
  now: number,
): { state: DriveState; charges: DriveCharge[] } {
  const last = engram.lastTickAt ? new Date(engram.lastTickAt).getTime() : now;
  const elapsedSec = clamp((now - last) / 1000, 0, MAX_ELAPSED_SEC);
  const state: DriveState = { ...(engram.driveState ?? {}) };
  const charges: DriveCharge[] = [];

  for (const drive of engram.drives) {
    const prev = typeof state[drive.id] === "number" ? state[drive.id] : 0;
    const jitter = 0.85 + Math.random() * 0.3;
    const gained = drive.baseRate * elapsedSec * jitter;
    const pressure = clamp(prev + gained, 0, 1);
    state[drive.id] = pressure;
    charges.push({
      id: drive.id,
      label: drive.label,
      description: drive.description,
      pressure,
      charge: pressure * drive.weight,
    });
  }
  charges.sort((a, b) => b.charge - a.charge);
  return { state, charges };
}

async function recentTransmissions(
  ownerId: string,
  engramId: number,
  since: number,
): Promise<EngramTransmission[]> {
  return db
    .select()
    .from(engramTransmissionsTable)
    .where(
      and(
        eq(engramTransmissionsTable.engramId, engramId),
        inArray(
          engramTransmissionsTable.engramId,
          db
            .select({ id: engramsTable.id })
            .from(engramsTable)
            .where(and(eq(engramsTable.id, engramId), eq(engramsTable.ownerId, ownerId))),
        ),
        gte(engramTransmissionsTable.createdAt, new Date(since)),
      ),
    )
    .orderBy(desc(engramTransmissionsTable.createdAt));
}

/**
 * Generate and persist a single transmission for an engram from a specific drive.
 * Resets that drive's pressure and bleeds the rest so it does not immediately re-fire.
 */
async function emit(
  engram: Engram,
  top: DriveCharge,
  state: DriveState,
  recentContents: string[],
  now: number,
  capabilities: Capabilities,
): Promise<EngramTransmission> {
  const kind = pickKind(top.id, top.label);
  const worldModelSummary = summarizeWorldModel(await loadRecentWorldModel(engram.id));
  const content = await generateTransmission({
    engram,
    kind,
    drive: { id: top.id, label: top.label, description: top.description },
    recentContents,
    worldModelSummary,
  });

  const importance = clamp(top.charge, 0, 1);
  const confidence = clamp(1 - engram.emotionalBaseline.volatility * 0.4, 0.3, 1);
  const dupe = recentContents.some(
    (c) => c.slice(0, 40).toLowerCase() === content.slice(0, 40).toLowerCase(),
  );
  const novelty = clamp((dupe ? 0.3 : 0.7) + Math.random() * 0.2, 0, 1);
  const overall = clamp(importance * 0.5 + confidence * 0.2 + novelty * 0.3, 0, 1);

  // Outreach is the engram self-initiating contact with the operator. Route the SAME
  // generated content through the bounded human-contact bus (one extra DB write, no
  // extra LLM call): the policy classifies priority from charge and decides whether
  // it is delivered now / queued / digested / blocked. With the chatConversation
  // target this ALSO mirrors the contact into the engram's own chat thread (unless the
  // bus blocked it) so the operator sees the engram speak up live. The transmission's
  // delivery flag mirrors the bus decision so the legacy transmission feed stays consistent.
  let wasDelivered = false;
  if (kind === "outreach") {
    // Only mirror into the engram's chat thread when the policy permits social-priority
    // contact (full_bounded, not quiet mode). Urgent-only / quiet contact still routes
    // through the bounded human-contact bus for audit, but stays off the chat feed.
    const { delivered } = await attemptOperatorContact({
      ownerId: engram.ownerId!,
      engram,
      capabilities,
      charge: top.charge,
      content: content || "…",
      target: capabilities.canMirrorHumanContactToChat ? "chatConversation" : "busOnly",
      now: new Date(now),
    });
    wasDelivered = delivered;
  }

  // Reset the firing drive and bleed the others.
  const nextState: DriveState = {};
  for (const [k, v] of Object.entries(state)) {
    nextState[k] = k === top.id ? 0.05 : clamp(v * 0.7, 0, 1);
  }

  const [row] = await db
    .insert(engramTransmissionsTable)
    .values({
      engramId: engram.id,
      kind,
      drive: top.label,
      content: content || "…",
      mood: engram.currentMood ?? engram.emotionalBaseline.mood,
      importanceScore: importance,
      confidenceScore: confidence,
      noveltyScore: novelty,
      overallScore: overall,
      wasDelivered,
      seen: false,
    })
    .returning();

  await db
    .update(engramsTable)
    .set({
      driveState: nextState,
      lastTransmissionAt: new Date(now),
      lastTickAt: new Date(now),
      backoffUntil: null, // a successful emit clears any prior error backoff
      updatedAt: new Date(now),
    })
    .where(eq(engramsTable.id, engram.id));

  // Record the act of speaking as a DESIRED world-model entry: the engram now holds
  // that, on its own, it wanted to express this drive. Best-effort — a failure here
  // must not roll back or re-emit the (already persisted) transmission.
  try {
    await appendWorldModelEntry({
      engramId: engram.id,
      provenance: "desired",
      content: `Acting on my own, I chose to ${
        kind === "outreach" ? "reach out" : "voice an idle transmission"
      } from my "${top.label}" drive.`,
      confidence: clamp(top.charge, 0, 1),
      scope: "private",
      source: "engine",
    });
  } catch (err) {
    logger.error({ err, engramId: engram.id }, "engram world-model DESIRED append failed");
  }

  return row;
}

export interface TickResult {
  ticked: number;
  generated: number;
  transmissions: EngramTransmission[];
}

/**
 * Process one engine tick. Accrues pressure for every autonomy-enabled engram and,
 * where an engram's top drive crosses its initiation threshold (subject to cooldown
 * and rate caps), generates exactly one transmission for it.
 *
 * @param opts.force ignore per-engram cadence (used by the manual /tick endpoint).
 */
export async function runTick(opts: { force?: boolean; ownerId?: string } = {}): Promise<TickResult> {
  if (!opts.ownerId) {
    const owners = await db
      .selectDistinct({ ownerId: engramsTable.ownerId })
      .from(engramsTable)
      .where(and(eq(engramsTable.autonomyEnabled, true), ne(engramsTable.ownerId, SYSTEM_OWNER_ID)));
    const results: TickResult[] = [];
    for (const { ownerId } of owners) {
      results.push(await runTick({ ...opts, ownerId }));
    }
    return {
      ticked: results.reduce((total, result) => total + result.ticked, 0),
      generated: results.reduce((total, result) => total + result.generated, 0),
      transmissions: results.flatMap((result) => result.transmissions),
    };
  }
  if (ticking) return { ticked: 0, generated: 0, transmissions: [] };
  ticking = true;
  const now = Date.now();
  const produced: EngramTransmission[] = [];
  let ticked = 0;

  try {
    const engrams = await db
      .select()
      .from(engramsTable)
      .where(
        and(eq(engramsTable.autonomyEnabled, true), eq(engramsTable.ownerId, opts.ownerId)),
      );

    // Load global runtime controls once per tick. A global pause (or quiet mode)
    // flows through capabilitiesFor below, so a paused engine only accrues/persists.
    const controls = await loadControls(opts.ownerId);

    // Load Hub state once per tick: an engram located in a space that disallows
    // initiative (quiescence/rest) accrues pressure but never self-initiates.
    const spaces = await loadSpaces(opts.ownerId);
    const spaceById = new Map<number, HubSpace>(spaces.map((s) => [s.id, s]));
    const presence = await loadPresence(opts.ownerId);
    const spaceByEngram = new Map<number, HubSpace>();
    const presenceByEngram = new Map<number, EngramPresence>();
    for (const p of presence) {
      presenceByEngram.set(p.engramId, p);
      const space = spaceById.get(p.spaceId);
      if (space) spaceByEngram.set(p.engramId, space);
    }
    const nameById = new Map<number, string>(engrams.map((e) => [e.id, e.name]));

    for (const engram of engrams) {
      const last = engram.lastTickAt ? new Date(engram.lastTickAt).getTime() : 0;
      const cadenceMs = engram.tickCadenceSeconds * 1000;
      // Cadence gates the routine persist-state pass, NOT initiation: pressure is
      // recomputed from lastTickAt every global tick, and a drive that crosses the
      // initiation threshold may fire immediately — engrams self-initiate on drive
      // pressure, not on a fixed timestamp schedule. Cooldown, backoff, rate caps
      // and the human-contact policy still bound how often that can happen.
      const cadenceDue = opts.force || now - last >= cadenceMs;

      const { state, charges } = accrue(engram, now);

      // Persist accrued pressure even when we don't generate (restart-safe).
      const persistState = async () => {
        await db
          .update(engramsTable)
          .set({ driveState: state, lastTickAt: new Date(now), updatedAt: new Date(now) })
          .where(eq(engramsTable.id, engram.id));
      };

      // Resolve current capabilities from mode + global controls + occupied space.
      // canIdle is false under a global pause, in quiescent mode, or while resting
      // in a no-initiative space — in all of which the engram accrues/persists but
      // never self-initiates. Engrams with no presence row (space === undefined)
      // behave exactly as before.
      const space = spaceByEngram.get(engram.id);
      const capabilities = capabilitiesFor({
        mode: engram.mode,
        controls,
        space: space
          ? { allowsInitiative: space.allowsInitiative, actionScope: space.actionScope }
          : undefined,
        humanContactEnabled: engram.humanContactEnabled,
      });

      const top = charges[0];
      const crossed = top && top.charge >= engram.initiationThreshold;
      const onCooldown =
        engram.lastTransmissionAt &&
        now - new Date(engram.lastTransmissionAt).getTime() < COOLDOWN_MS;
      const backoffUntil = engram.backoffUntil ? new Date(engram.backoffUntil).getTime() : 0;
      const inBackoff = now < backoffUntil;

      if (!capabilities.canIdle || !crossed || onCooldown || inBackoff) {
        // Nothing fires this tick. Only persist on the engram's own cadence so a
        // 20s global tick doesn't multiply DB writes; unpersisted pressure is not
        // lost — accrue() recomputes it from lastTickAt.
        if (cadenceDue) {
          ticked++;
          await persistState();
        }
        continue;
      }
      ticked++;

      // Rate caps (rolling hour / day).
      const recent = await recentTransmissions(opts.ownerId, engram.id, now - 24 * 3600_000);
      const hourCount = recent.filter(
        (r) => now - new Date(r.createdAt).getTime() < 3600_000,
      ).length;
      if (recent.length >= DAILY_CAP || hourCount >= HOURLY_CAP) {
        await persistState();
        continue;
      }

      try {
        const tx = await emit(
          engram,
          top,
          state,
          recent.slice(0, 5).map((r) => r.content),
          now,
          capabilities,
        );
        produced.push(tx);
      } catch (err) {
        const providerError = normalizeLLMProviderError(err);
        logger.error(
          { err: providerError, engramId: engram.id, providerCode: providerError.code },
          "engram transmission generation failed",
        );
        // Persist the backoff (and accrued pressure) so a restart can't bypass it.
        await db
          .update(engramsTable)
          .set({
            driveState: state,
            lastTickAt: new Date(now),
            backoffUntil: new Date(now + ERROR_BACKOFF_MS),
            updatedAt: new Date(now),
          })
          .where(eq(engramsTable.id, engram.id));
      }
    }

    // Commons phase: at most ONE engram-to-engram conversation turn per tick,
    // turn-taking among converse-capable engrams present in the commons. Best-effort
    // — a failure here must not abort the tick or roll back transmissions above.
    try {
      await maybeRunCommonsTurn({
        controls,
        engrams,
        spaceById,
        presenceByEngram,
        nameById,
        now,
      });
    } catch (err) {
      logger.error({ err }, "commons conversation turn failed");
    }

    // Simulation phase: at most ONE bounded simulation action per tick (step a
    // running sim, or a capable engram in the chamber opens a new one). Everything
    // it writes is quarantined as a SIMULATED world-model entry. Best-effort — a
    // failure here must not abort the tick or roll back anything above.
    try {
      await maybeRunSimulationStep({
        controls,
        engrams,
        spaceById,
        presenceByEngram,
        now,
      });
    } catch (err) {
      logger.error({ err }, "simulation step failed");
    }

    // Artifact phase: at most ONE autonomous artifact enqueued per tick (a capable
    // engram present in the studio authors a bounded document). Always a PDF —
    // always-local, zero-cost, offline-safe; cost-incurring image/video stays
    // operator-consented. The artifact worker generates the queued job. Best-effort
    // — a failure here must not abort the tick or roll back anything above.
    try {
      await maybeRunArtifactGeneration({
        controls,
        engrams,
        spaceById,
        presenceByEngram,
        now,
      });
    } catch (err) {
      logger.error({ err }, "artifact generation step failed");
    }
  } finally {
    ticking = false;
  }

  return { ticked, generated: produced.length, transmissions: produced };
}

/**
 * Force a single transmission for one engram now, bypassing threshold/cadence (still
 * respects the error backoff). Used by the manual /transmit endpoint.
 */
export async function forceTransmission(engram: Engram): Promise<EngramTransmission> {
  const now = Date.now();
  const { state, charges } = accrue(engram, now);
  const top = charges[0] ?? {
    id: engram.drives[0]?.id ?? "drive",
    label: engram.drives[0]?.label ?? "impulse",
    description: engram.drives[0]?.description ?? "",
    pressure: 0.6,
    charge: 0.6,
  };
  const ownerId = engram.ownerId;
  if (!ownerId) throw new Error("Cannot transmit for an engram without an owner");
  const recent = await recentTransmissions(ownerId, engram.id, now - 24 * 3600_000);

  // Operator-forced, but still routed through the same capability/human-contact
  // policy so a forced outreach respects pause/quiet/quiescence and the rate caps.
  const controls = await loadControls(ownerId);
  const presence = await loadPresenceForEngram(engram.id, ownerId);
  const space = presence ? await loadSpaceById(presence.spaceId, ownerId) : undefined;
  const capabilities = capabilitiesFor({
    mode: engram.mode,
    controls,
    space: space
      ? { allowsInitiative: space.allowsInitiative, actionScope: space.actionScope }
      : undefined,
    humanContactEnabled: engram.humanContactEnabled,
  });

  return emit(
    engram,
    top,
    state,
    recent.slice(0, 5).map((r) => r.content),
    now,
    capabilities,
  );
}

export function startEngramEngine(): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    runTick().catch((err) => logger.error({ err }, "engram engine tick failed"));
  }, GLOBAL_TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ intervalMs: GLOBAL_TICK_MS }, "engram engine started");
}

export function stopEngramEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  started = false;
}
