import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  closeDb,
  db,
  engramSimulationParticipantsTable,
  engramSimulationStepsTable,
  engramSimulationsTable,
  engramsTable,
  ensureDatabaseReady,
  hubSpacesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildPerceptualContext } from "./perceptual-context";
import {
  createSimulation,
  loadSimulationById,
  loadSimulationParticipantIds,
  loadSimulationParticipants,
  loadSimulations,
  markSimulationParticipantSpoke,
} from "./simulations-store";

const OWNER_ID = "simulation-persistence-owner";
const ready = ensureDatabaseReady({ seed: false });

beforeEach(async () => {
  await ready;
  await db.delete(engramSimulationParticipantsTable);
  await db.delete(engramSimulationStepsTable);
  await db.delete(engramSimulationsTable);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
});

afterAll(async () => {
  await closeDb();
});

async function insertEngram(name: string) {
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: OWNER_ID,
      slug: `simulation-${name.toLowerCase()}-${Date.now()}-${Math.random()}`,
      name,
      title: `${name} simulation fixture`,
      symbol: "S",
      origin: "simulation persistence test",
      voiceProfile: {
        speechStyle: "plain",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: { valence: 0, arousal: 0.3, volatility: 0.2, mood: "even" },
      environmentAnchor: {
        name: "Test chamber",
        description: "A simulation persistence fixture",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: { relationship: "test", facts: [], summary: "" },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

async function insertChamber() {
  const [row] = await db
    .insert(hubSpacesTable)
    .values({
      ownerId: OWNER_ID,
      slug: `simulation-chamber-${Date.now()}-${Math.random()}`,
      name: "Simulation Chamber",
      kind: "simulation_chamber",
      description: "Simulation persistence fixture",
      visibilityScope: "operators",
      actionScope: "simulate",
      logged: true,
      allowsInitiative: true,
    })
    .returning({ id: hubSpacesTable.id });
  return row.id;
}

function simulationValues(engramId: number, spaceId: number) {
  return {
    ownerId: OWNER_ID,
    engramId,
    spaceId,
    premise: "What if the archive remembered its visitors?",
    status: "running" as const,
    currentStep: 4,
    maxSteps: 12,
    stepCooldownSeconds: 60,
    lastSteppedAt: new Date("2026-09-13T12:00:00.000Z"),
  };
}

describe("shared simulation persistence", () => {
  it("reloads participants and least-recently-spoken state after creation", async () => {
    const primaryId = await insertEngram("Primary");
    const secondaryId = await insertEngram("Secondary");
    const spaceId = await insertChamber();
    const simulation = await createSimulation(
      simulationValues(primaryId, spaceId),
      [primaryId, secondaryId],
    );

    const spokeAt = new Date("2026-09-13T12:05:00.000Z");
    await markSimulationParticipantSpoke(simulation.id, secondaryId, spokeAt);

    const reloaded = await loadSimulationById(simulation.id, OWNER_ID);
    const participants = await loadSimulationParticipants(simulation.id, OWNER_ID);
    const participantIds = await loadSimulationParticipantIds(reloaded!);

    expect(reloaded).toMatchObject({
      id: simulation.id,
      engramId: primaryId,
      currentStep: 4,
      status: "running",
    });
    expect(participantIds).toEqual([primaryId, secondaryId]);
    expect(participants).toHaveLength(2);
    expect(participants.map((participant) => participant.engramId)).toEqual([
      primaryId,
      secondaryId,
    ]);
    expect(
      participants.find((participant) => participant.engramId === secondaryId)?.lastSpokeAt,
    ).toEqual(spokeAt);
  });

  it("falls back to the primary engram for legacy simulations without participant rows", async () => {
    const primaryId = await insertEngram("Legacy Primary");
    const spaceId = await insertChamber();
    const [legacy] = await db
      .insert(engramSimulationsTable)
      .values(simulationValues(primaryId, spaceId))
      .returning();

    await expect(
      db
        .select()
        .from(engramSimulationParticipantsTable)
        .where(eq(engramSimulationParticipantsTable.simulationId, legacy.id)),
    ).resolves.toHaveLength(0);
    await expect(loadSimulationParticipantIds(legacy)).resolves.toEqual([primaryId]);
  });

  it("finds shared simulations through participant membership, including perceptual context", async () => {
    const primaryId = await insertEngram("Shared Primary");
    const secondaryId = await insertEngram("Shared Secondary");
    const unrelatedId = await insertEngram("Unrelated");
    const spaceId = await insertChamber();
    const shared = await createSimulation(
      simulationValues(primaryId, spaceId),
      [primaryId, secondaryId],
    );
    const primaryOnly = await createSimulation(
      {
        ...simulationValues(primaryId, spaceId),
        premise: "Primary-only scenario",
      },
      [primaryId],
    );

    const secondaryRows = await loadSimulations({
      ownerId: OWNER_ID,
      engramId: secondaryId,
    });
    const primaryRows = await loadSimulations({
      ownerId: OWNER_ID,
      engramId: primaryId,
    });
    const unrelatedRows = await loadSimulations({
      ownerId: OWNER_ID,
      engramId: unrelatedId,
    });
    const secondaryContext = await buildPerceptualContext({ engramId: secondaryId });
    const unrelatedContext = await buildPerceptualContext({ engramId: unrelatedId });

    expect(secondaryRows.map((row) => row.id)).toEqual([shared.id]);
    expect(new Set(primaryRows.map((row) => row.id))).toEqual(
      new Set([shared.id, primaryOnly.id]),
    );
    expect(unrelatedRows).toEqual([]);
    expect(secondaryContext).toContain("archive remembered its visitors");
    expect(unrelatedContext).toBe("");
    expect(primaryOnly.id).not.toBe(shared.id);
  });
});