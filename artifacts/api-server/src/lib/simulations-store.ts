import { db } from "@workspace/db";
import {
  engramSimulationsTable,
  engramSimulationStepsTable,
  type EngramSimulation,
  type EngramSimulationStep,
  type NewEngramSimulation,
  type SimulationStatus,
  type EngramWorldModelEntry,
} from "@workspace/db/schema";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { appendWorldModelEntry } from "./world-model-store";

/** A simulation is "active" (occupying its engram's single slot) until it ends. */
const NON_ENDED: SimulationStatus[] = ["proposed", "running", "paused"];

/** List simulations, newest first, optionally filtered by engram and/or status. */
export async function loadSimulations(opts: {
  engramId?: number;
  status?: SimulationStatus;
} = {}): Promise<EngramSimulation[]> {
  const filters = [];
  if (typeof opts.engramId === "number")
    filters.push(eq(engramSimulationsTable.engramId, opts.engramId));
  if (opts.status) filters.push(eq(engramSimulationsTable.status, opts.status));
  const where = filters.length ? and(...filters) : undefined;
  return db
    .select()
    .from(engramSimulationsTable)
    .where(where)
    .orderBy(desc(engramSimulationsTable.createdAt));
}

export async function loadSimulationById(
  id: number,
): Promise<EngramSimulation | undefined> {
  const [row] = await db
    .select()
    .from(engramSimulationsTable)
    .where(eq(engramSimulationsTable.id, id));
  return row;
}

/**
 * The single non-ended simulation an engram currently owns, if any. The engine
 * enforces at most one active simulation per engram by consulting this before
 * proposing a new one.
 */
export async function loadActiveSimulationForEngram(
  engramId: number,
): Promise<EngramSimulation | undefined> {
  const [row] = await db
    .select()
    .from(engramSimulationsTable)
    .where(
      and(
        eq(engramSimulationsTable.engramId, engramId),
        ne(engramSimulationsTable.status, "ended"),
      ),
    )
    .orderBy(desc(engramSimulationsTable.createdAt))
    .limit(1);
  return row;
}

/** All currently-running simulations, least-recently-stepped first (turn-taking). */
export async function loadRunningSimulations(): Promise<EngramSimulation[]> {
  return db
    .select()
    .from(engramSimulationsTable)
    .where(eq(engramSimulationsTable.status, "running"))
    .orderBy(asc(engramSimulationsTable.lastSteppedAt));
}

/** Count an engram's non-ended simulations (cap guard). */
export async function countActiveSimulations(engramId: number): Promise<number> {
  const rows = await db
    .select({ id: engramSimulationsTable.id })
    .from(engramSimulationsTable)
    .where(
      and(
        eq(engramSimulationsTable.engramId, engramId),
        ne(engramSimulationsTable.status, "ended"),
      ),
    );
  return rows.length;
}

export async function createSimulation(
  values: NewEngramSimulation,
): Promise<EngramSimulation> {
  const [row] = await db
    .insert(engramSimulationsTable)
    .values(values)
    .returning();
  return row;
}

/** Patch a simulation row, always stamping updatedAt. Never touches step/world-model rows. */
export async function updateSimulation(
  id: number,
  patch: Partial<{
    status: SimulationStatus;
    currentStep: number;
    exitSummary: string;
    lastSteppedAt: Date;
    startedAt: Date;
    pausedAt: Date;
    endedAt: Date;
  }>,
): Promise<EngramSimulation> {
  const [row] = await db
    .update(engramSimulationsTable)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(engramSimulationsTable.id, id))
    .returning();
  return row;
}

/**
 * Atomically claim the next step of a running simulation (compare-and-swap on
 * currentStep + status). Returns the updated row when this caller won the claim,
 * or null when another caller (engine tick vs. immediate kick vs. concurrent
 * control) already advanced it — the loser must skip, so a step number can never
 * be generated or appended twice.
 */
export async function claimSimulationStep(
  id: number,
  expectedCurrentStep: number,
  now: Date,
): Promise<EngramSimulation | null> {
  const [row] = await db
    .update(engramSimulationsTable)
    .set({
      currentStep: expectedCurrentStep + 1,
      lastSteppedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(engramSimulationsTable.id, id),
        eq(engramSimulationsTable.currentStep, expectedCurrentStep),
        eq(engramSimulationsTable.status, "running"),
      ),
    )
    .returning();
  return row ?? null;
}

export async function loadSimulationSteps(
  simulationId: number,
): Promise<EngramSimulationStep[]> {
  return db
    .select()
    .from(engramSimulationStepsTable)
    .where(eq(engramSimulationStepsTable.simulationId, simulationId))
    .orderBy(asc(engramSimulationStepsTable.stepNumber));
}

/**
 * Record one simulation step. This is the ONLY place a simulation writes to the
 * world-model, and it ALWAYS does so with provenance "simulated" — the provenance
 * is hardcoded here and never parameterized. That is the structural quarantine:
 * simulated state can never be created as (or relabeled to) observed reality. The
 * step row links back to the entry it spawned for an auditable trail.
 */
export async function appendSimulationStep(opts: {
  simulation: EngramSimulation;
  stepNumber: number;
  narrative: string;
  confidence: number;
}): Promise<{ step: EngramSimulationStep; worldModelEntry: EngramWorldModelEntry }> {
  const worldModelEntry = await appendWorldModelEntry({
    engramId: opts.simulation.engramId,
    provenance: "simulated",
    content: opts.narrative,
    confidence: opts.confidence,
    scope: "private",
    source: `sim:${opts.simulation.id}`,
  });

  const [step] = await db
    .insert(engramSimulationStepsTable)
    .values({
      simulationId: opts.simulation.id,
      stepNumber: opts.stepNumber,
      narrative: opts.narrative,
      worldModelEntryId: worldModelEntry.id,
    })
    .returning();

  return { step, worldModelEntry };
}
