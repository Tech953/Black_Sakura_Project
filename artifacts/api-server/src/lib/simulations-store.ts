import { db } from "@workspace/db";
import {
  engramSimulationsTable,
  engramSimulationParticipantsTable,
  engramSimulationStepsTable,
  type EngramSimulation,
  type EngramSimulationParticipant,
  type EngramSimulationStep,
  type NewEngramSimulation,
  type SimulationStatus,
  type EngramWorldModelEntry,
} from "@workspace/db/schema";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { appendWorldModelEntry } from "./world-model-store";
import { SYSTEM_OWNER_ID } from "@workspace/db/schema";

/** A simulation is "active" (occupying its engram's single slot) until it ends. */
const NON_ENDED: SimulationStatus[] = ["proposed", "running", "paused"];

/** List simulations, newest first, optionally filtered by engram and/or status. */
export async function loadSimulations(opts: {
  ownerId: string;
  engramId?: number;
  status?: SimulationStatus;
}): Promise<EngramSimulation[]> {
  const filters = [eq(engramSimulationsTable.ownerId, opts.ownerId)];
  if (opts.status) filters.push(eq(engramSimulationsTable.status, opts.status));
  const where = filters.length ? and(...filters) : undefined;
  const query = db.select().from(engramSimulationsTable);
  if (typeof opts.engramId === "number") {
    return query
      .innerJoin(
        engramSimulationParticipantsTable,
        eq(engramSimulationParticipantsTable.simulationId, engramSimulationsTable.id),
      )
      .where(
        and(
          ...filters,
          eq(engramSimulationParticipantsTable.engramId, opts.engramId),
        ),
      )
      .orderBy(desc(engramSimulationsTable.createdAt))
      .then((rows) => rows.map((row) => row.engram_simulations));
  }
  return query.where(where).orderBy(desc(engramSimulationsTable.createdAt));
}

export async function loadSimulationById(
  id: number,
  ownerId: string,
): Promise<EngramSimulation | undefined> {
  const [row] = await db
    .select()
    .from(engramSimulationsTable)
    .where(and(eq(engramSimulationsTable.id, id), eq(engramSimulationsTable.ownerId, ownerId)));
  return row;
}

/** Load durable membership and turn-taking state for a simulation. */
export async function loadSimulationParticipants(
  simulationId: number,
  ownerId?: string,
): Promise<EngramSimulationParticipant[]> {
  const filters = [eq(engramSimulationParticipantsTable.simulationId, simulationId)];
  if (ownerId) filters.push(eq(engramSimulationParticipantsTable.ownerId, ownerId));
  return db
    .select()
    .from(engramSimulationParticipantsTable)
    .where(and(...filters))
    .orderBy(asc(engramSimulationParticipantsTable.joinedAt));
}

/**
 * Return participant IDs with a compatibility fallback for rows created before
 * the participant table existed.
 */
export async function loadSimulationParticipantIds(
  simulation: Pick<EngramSimulation, "id" | "engramId" | "ownerId">,
): Promise<number[]> {
  const participants = await loadSimulationParticipants(simulation.id, simulation.ownerId);
  return participants.length ? participants.map((p) => p.engramId) : [simulation.engramId];
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
    .select({ simulation: engramSimulationsTable })
    .from(engramSimulationsTable)
    .innerJoin(
      engramSimulationParticipantsTable,
      eq(engramSimulationParticipantsTable.simulationId, engramSimulationsTable.id),
    )
    .where(
      and(
        eq(engramSimulationParticipantsTable.engramId, engramId),
        ne(engramSimulationsTable.status, "ended"),
      ),
    )
    .orderBy(desc(engramSimulationsTable.createdAt))
    .limit(1);
  return row?.simulation;
}

/** All currently-running simulations, least-recently-stepped first (turn-taking). */
export async function loadRunningSimulations(): Promise<EngramSimulation[]> {
  return db
    .select()
    .from(engramSimulationsTable)
    .where(
      and(
        eq(engramSimulationsTable.status, "running"),
        ne(engramSimulationsTable.ownerId, SYSTEM_OWNER_ID),
      ),
    )
    .orderBy(asc(engramSimulationsTable.lastSteppedAt));
}

/** Count an engram's non-ended simulations (cap guard). */
export async function countActiveSimulations(engramId: number): Promise<number> {
  const rows = await db
    .select({ id: engramSimulationsTable.id })
    .from(engramSimulationsTable)
    .innerJoin(
      engramSimulationParticipantsTable,
      eq(engramSimulationParticipantsTable.simulationId, engramSimulationsTable.id),
    )
    .where(
      and(
        eq(engramSimulationParticipantsTable.engramId, engramId),
        ne(engramSimulationsTable.status, "ended"),
      ),
    );
  return rows.length;
}

export async function createSimulation(
  values: NewEngramSimulation,
  participantEngramIds: number[] = [values.engramId],
): Promise<EngramSimulation> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(engramSimulationsTable).values(values).returning();
    const participantIds = [...new Set([values.engramId, ...participantEngramIds])];
    await tx.insert(engramSimulationParticipantsTable).values(
      participantIds.map((engramId) => ({
        simulationId: row.id,
        engramId,
        ownerId: values.ownerId,
      })),
    );
    return row;
  });
}

/** Patch a simulation row, always stamping updatedAt. Never touches step/world-model rows. */
export async function updateSimulation(
  id: number,
  ownerId: string,
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
    .where(and(eq(engramSimulationsTable.id, id), eq(engramSimulationsTable.ownerId, ownerId)))
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
  ownerId: string,
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
        eq(engramSimulationsTable.ownerId, ownerId),
        eq(engramSimulationsTable.currentStep, expectedCurrentStep),
        eq(engramSimulationsTable.status, "running"),
      ),
    )
    .returning();
  return row ?? null;
}

/** Stamp the participant who just took the turn for least-recently-spoken ordering. */
export async function markSimulationParticipantSpoke(
  simulationId: number,
  engramId: number,
  at: Date,
): Promise<void> {
  await db
    .update(engramSimulationParticipantsTable)
    .set({ lastSpokeAt: at })
    .where(
      and(
        eq(engramSimulationParticipantsTable.simulationId, simulationId),
        eq(engramSimulationParticipantsTable.engramId, engramId),
      ),
    );
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
  speakerEngramId?: number;
  narrative: string;
  confidence: number;
}): Promise<{ step: EngramSimulationStep; worldModelEntry: EngramWorldModelEntry }> {
  const worldModelEntry = await appendWorldModelEntry({
    engramId: opts.speakerEngramId ?? opts.simulation.engramId,
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
      speakerEngramId: opts.speakerEngramId ?? opts.simulation.engramId,
      narrative: opts.narrative,
      worldModelEntryId: worldModelEntry.id,
    })
    .returning();

  return { step, worldModelEntry };
}
