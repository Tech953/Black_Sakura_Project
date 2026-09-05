import { db } from "@workspace/db";
import { engramsTable, type Engram, type EngramSimulation } from "@workspace/db/schema";
import type { EngramPresence, HubSpace } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { publishEvent } from "./events";
import { capabilitiesFor, type GlobalControls } from "./engram-policy";
import {
  generateSimulationPremise,
  generateSimulationStep,
  generateSimulationExitSummary,
} from "./engram-generation";
import { summarizeWorldModel } from "./world-model";
import { loadRecentWorldModel } from "./world-model-store";
import { appendActivity, loadPresenceForEngram, loadSpaceById } from "./hub-store";
import { loadControls } from "./controls-store";
import {
  appendSimulationStep,
  claimSimulationStep,
  createSimulation,
  loadActiveSimulationForEngram,
  loadRunningSimulations,
  loadSimulationSteps,
  updateSimulation,
} from "./simulations-store";

/** Hard ceiling on a simulation's step count, regardless of requested maxSteps. */
export const SIMULATION_MAX_STEPS_CAP = 10;

/**
 * Confidence stamped on a simulation step's world-model entry. Deliberately
 * middling: simulated beliefs are hypothetical, never held as firmly as observed
 * reality (and are quarantined under provenance "simulated" regardless).
 */
export const SIMULATION_STEP_CONFIDENCE = 0.5;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export type SimulationAction = "start" | "pause" | "resume" | "end";

/** Thrown when an operator control action is illegal for the simulation's current status. */
export class SimulationTransitionError extends Error {}

async function loadEngramRow(id: number): Promise<Engram | undefined> {
  const [row] = await db.select().from(engramsTable).where(eq(engramsTable.id, id));
  return row;
}

/**
 * Apply an operator control action, enforcing the lifecycle
 * proposed → running ↔ paused → ended. Illegal transitions throw
 * SimulationTransitionError; status is never taken from model output.
 */
export async function applySimulationControl(
  sim: EngramSimulation,
  action: SimulationAction,
): Promise<EngramSimulation> {
  switch (action) {
    case "start":
      if (sim.status !== "proposed")
        throw new SimulationTransitionError(`cannot start a simulation in status "${sim.status}"`);
      return updateSimulation(sim.id, sim.ownerId, {
        status: "running",
        startedAt: sim.startedAt ?? new Date(),
      });
    case "resume":
      if (sim.status !== "paused")
        throw new SimulationTransitionError(`cannot resume a simulation in status "${sim.status}"`);
      return updateSimulation(sim.id, sim.ownerId, { status: "running" });
    case "pause":
      if (sim.status !== "running")
        throw new SimulationTransitionError(`cannot pause a simulation in status "${sim.status}"`);
      return updateSimulation(sim.id, sim.ownerId, { status: "paused", pausedAt: new Date() });
    case "end":
      if (sim.status === "ended")
        throw new SimulationTransitionError("simulation already ended");
      return endSimulation(sim);
  }
}

/**
 * End a simulation. If it has no exit summary yet, generate one best-effort (the
 * engram reflects on the run, in-voice). A generation failure never blocks the
 * end transition — the simulation still closes.
 */
export async function endSimulation(sim: EngramSimulation): Promise<EngramSimulation> {
  let exitSummary = sim.exitSummary ?? undefined;
  if (!exitSummary) {
    try {
      const engram = await loadEngramRow(sim.engramId);
      if (engram) {
        const steps = await loadSimulationSteps(sim.id);
        exitSummary = await generateSimulationExitSummary({
          engram,
          premise: sim.premise,
          steps: steps.map((s) => s.narrative),
        });
      }
    } catch (err) {
      logger.warn({ err, simulationId: sim.id }, "simulation exit-summary generation failed");
    }
  }
  return updateSimulation(sim.id, sim.ownerId, {
    status: "ended",
    endedAt: new Date(),
    ...(exitSummary ? { exitSummary } : {}),
  });
}

/** Outcome of a single simulation engine action (at most one per tick). */
export type SimulationTickOutcome = {
  kind: "stepped" | "created" | "ended";
  simulationId: number;
};

/** Resolve simulation capability for an engram occupying a given chamber space. */
function canEngramSimulate(
  engram: Engram,
  space: HubSpace,
  controls: GlobalControls,
): boolean {
  return capabilitiesFor({
    mode: engram.mode,
    controls,
    space: { allowsInitiative: space.allowsInitiative, actionScope: space.actionScope },
    humanContactEnabled: engram.humanContactEnabled,
    simulationEnabled: engram.simulationEnabled,
  }).canSimulate;
}

/**
 * Advance one running simulation by a single bounded step: generate the next beat,
 * persist it as a SIMULATED world-model entry (the only write path, via
 * appendSimulationStep — provenance is hardcoded there), and bump the step counter.
 * When the step cap is reached the simulation auto-ends with an exit summary.
 */
async function advanceSimulation(
  sim: EngramSimulation,
  engram: Engram,
  now: number,
): Promise<SimulationTickOutcome | null> {
  if (engram.ownerId !== sim.ownerId) {
    logger.warn({ simulationId: sim.id }, "simulation owner no longer matches its engram");
    return null;
  }
  // Atomically claim the step first (CAS on currentStep + running status). The
  // engine tick, an immediate kick, and concurrent control requests can all race
  // here; only one wins, so a step number can never be generated twice.
  const claimed = await claimSimulationStep(sim.id, sim.ownerId, sim.currentStep, new Date(now));
  if (!claimed) return null;

  const maxSteps = Math.min(sim.maxSteps, SIMULATION_MAX_STEPS_CAP);
  const nextStep = claimed.currentStep;
  const priorSteps = (await loadSimulationSteps(sim.id)).map((s) => s.narrative);
  const worldModelSummary = summarizeWorldModel(await loadRecentWorldModel(engram.id));

  const narrative =
    (
      await generateSimulationStep({
        engram,
        premise: sim.premise,
        stepNumber: nextStep,
        maxSteps,
        priorSteps,
        worldModelSummary,
      })
    ).trim() || "…";

  await appendSimulationStep({
    simulation: sim,
    stepNumber: nextStep,
    narrative,
    confidence: SIMULATION_STEP_CONFIDENCE,
  });

  publishEvent({
    type: "simulation.step",
    ownerId: sim.ownerId,
    engramId: engram.id,
    data: {
      simulationId: sim.id,
      spaceId: sim.spaceId,
      step: nextStep,
      maxSteps,
      narrative,
    },
  });

  try {
    await appendActivity({
      ownerId: sim.ownerId,
      spaceId: sim.spaceId,
      engramId: engram.id,
      kind: "system",
      summary: `${engram.name} advanced a simulation (step ${nextStep}/${maxSteps}).`,
    });
  } catch (err) {
    logger.error({ err, engramId: engram.id }, "simulation step activity append failed");
  }

  if (nextStep >= maxSteps) {
    await endSimulation(claimed);
    return { kind: "ended", simulationId: sim.id };
  }
  return { kind: "stepped", simulationId: sim.id };
}

/** A capable engram with no active simulation proposes and opens a new running one. */
async function proposeSimulation(
  engram: Engram,
  chamber: HubSpace,
  now: number,
): Promise<SimulationTickOutcome | null> {
  const worldModelSummary = summarizeWorldModel(await loadRecentWorldModel(engram.id));
  const premise = (await generateSimulationPremise({ engram, worldModelSummary })).trim();
  if (!premise) return null;

  const sim = await createSimulation({
    ownerId: engram.ownerId!,
    engramId: engram.id,
    spaceId: chamber.id,
    premise,
    status: "running",
    currentStep: 0,
    startedAt: new Date(now),
  });

  try {
    await appendActivity({
      ownerId: chamber.ownerId,
      spaceId: chamber.id,
      engramId: engram.id,
      kind: "system",
      summary: `${engram.name} opened a simulation: "${premise.slice(0, 80)}".`,
    });
  } catch (err) {
    logger.error({ err, engramId: engram.id }, "simulation create activity append failed");
  }
  return { kind: "created", simulationId: sim.id };
}

/**
 * Operator-directed simulation: open a new running simulation for an engram with a
 * specific, operator-supplied premise ("scenario stipulations"). Same quarantine as
 * autonomous simulations — every step it produces goes through appendSimulationStep,
 * which hardcodes provenance "simulated". The engram must be present in the chamber
 * and capable (canSimulate), so a paused system or simulationEnabled=false blocks it.
 */
export async function openOperatorSimulation(opts: {
  engram: Engram;
  chamber: HubSpace;
  premise: string;
  maxSteps?: number;
  controls: GlobalControls;
  now?: number;
}): Promise<EngramSimulation> {
  const { engram, chamber, premise, controls } = opts;
  const now = opts.now ?? Date.now();
  // Re-check DB-backed presence here (not only in the route) so the safety
  // assertion is local to the write: the engram must actually be active in the
  // chamber at creation time.
  const presence = await loadPresenceForEngram(engram.id, chamber.ownerId);
  if (!presence || presence.spaceId !== chamber.id || presence.status !== "active") {
    throw new SimulationTransitionError(
      `${engram.name} must be present in the simulation chamber to run a simulation`,
    );
  }
  if (!canEngramSimulate(engram, chamber, controls)) {
    throw new SimulationTransitionError(
      "this engram cannot simulate right now (simulation disabled, paused, or mode disallows it)",
    );
  }
  const active = await loadActiveSimulationForEngram(engram.id);
  if (active) {
    throw new SimulationTransitionError(
      `engram already has an active simulation (#${active.id}) — end or pause it first`,
    );
  }
  const sim = await createSimulation({
    ownerId: engram.ownerId!,
    engramId: engram.id,
    spaceId: chamber.id,
    premise,
    status: "running",
    currentStep: 0,
    ...(opts.maxSteps ? { maxSteps: Math.min(opts.maxSteps, SIMULATION_MAX_STEPS_CAP) } : {}),
    startedAt: new Date(now),
  });
  try {
    await appendActivity({
      ownerId: chamber.ownerId,
      spaceId: chamber.id,
      engramId: engram.id,
      kind: "system",
      summary: `Operator opened a simulation for ${engram.name}: "${premise.slice(0, 80)}".`,
    });
  } catch (err) {
    logger.error({ err, engramId: engram.id }, "operator simulation activity append failed");
  }
  return sim;
}

/**
 * Best-effort immediate step for a just-started/resumed/created simulation, so the
 * operator sees a beat without waiting for the next engine tick. Re-checks presence
 * and capability; never throws.
 */
export async function kickSimulation(sim: EngramSimulation): Promise<void> {
  try {
    if (sim.status !== "running") return;
    // Honor the per-step cooldown so a rapid pause/resume can't fan out steps
    // faster than the engine would allow.
    const now = Date.now();
    const last = sim.lastSteppedAt ? sim.lastSteppedAt.getTime() : null;
    if (last !== null && now - last < sim.stepCooldownSeconds * 1000) return;
    const engram = await loadEngramRow(sim.engramId);
    if (!engram) return;
    const presence = await loadPresenceForEngram(engram.id, sim.ownerId);
    if (!presence || presence.spaceId !== sim.spaceId || presence.status !== "active") return;
    const space = await loadSpaceById(sim.spaceId, sim.ownerId);
    if (!space) return;
    const controls = await loadControls(sim.ownerId);
    if (!canEngramSimulate(engram, space, controls)) return;
    await advanceSimulation(sim, engram, now);
  } catch (err) {
    logger.warn({ err, simulationId: sim.id }, "immediate simulation step failed (will retry on tick)");
  }
}

/**
 * Run at most ONE simulation action this tick (cost guard), inside the simulation
 * chamber, mirroring the commons phase.
 *
 * Priority: step a running simulation (least-recently-stepped first, once its
 * per-step cooldown elapses) whose owner is still capable and present. If none is
 * eligible, a capable engram present in the chamber with no active simulation
 * proposes and opens a new one. Capability gates on canSimulate, so a global pause,
 * a per-engram simulationEnabled=false, or a paused/quiescent mode all short-circuit
 * before any model call or world-model write. Returns the action taken, or null.
 */
export async function maybeRunSimulationStep(opts: {
  controls: GlobalControls;
  engrams: Engram[];
  spaceById: Map<number, HubSpace>;
  presenceByEngram: Map<number, EngramPresence>;
  now: number;
}): Promise<SimulationTickOutcome | null> {
  const { controls, engrams, spaceById, presenceByEngram, now } = opts;

  const chamber = [...spaceById.values()].find((s) => s.kind === "simulation_chamber");
  if (!chamber) return null;

  const engramById = new Map<number, Engram>(engrams.map((e) => [e.id, e]));

  // 1) STEP PHASE — least-recently-stepped running sim first.
  const running = await loadRunningSimulations();
  for (const sim of running) {
    const engram = engramById.get(sim.engramId);
    if (!engram) continue;
    const presence = presenceByEngram.get(engram.id);
    if (!presence || presence.spaceId !== sim.spaceId || presence.status !== "active") {
      // The engram left the chamber mid-run. Auto-pause instead of silently
      // freezing so the operator sees an honest state and can resume later.
      try {
        await updateSimulation(sim.id, sim.ownerId, { status: "paused", pausedAt: new Date(now) });
        await appendActivity({
          ownerId: sim.ownerId,
          spaceId: sim.spaceId,
          engramId: engram.id,
          kind: "system",
          summary: `${engram.name}'s simulation paused — they left the chamber.`,
        });
      } catch (err) {
        logger.error({ err, simulationId: sim.id }, "auto-pause of orphaned simulation failed");
      }
      continue;
    }
    const space = spaceById.get(sim.spaceId);
    if (!space || !canEngramSimulate(engram, space, controls)) continue;

    const last = sim.lastSteppedAt ? sim.lastSteppedAt.getTime() : null;
    if (last !== null && now - last < sim.stepCooldownSeconds * 1000) continue;

    const out = await advanceSimulation(sim, engram, now);
    if (out) return out;
    continue;
  }

  // 2) PROPOSE PHASE — a capable, present engram with no active sim opens one.
  for (const engram of engrams) {
    const presence = presenceByEngram.get(engram.id);
    if (!presence || presence.spaceId !== chamber.id || presence.status !== "active") continue;
    if (!canEngramSimulate(engram, chamber, controls)) continue;
    const active = await loadActiveSimulationForEngram(engram.id);
    if (active) continue;

    const outcome = await proposeSimulation(engram, chamber, now);
    if (outcome) return outcome;
  }

  return null;
}
