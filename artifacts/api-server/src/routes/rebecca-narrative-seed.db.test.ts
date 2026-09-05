import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  closeDb,
  conversations,
  db,
  engramWorldModelTable,
  engramsTable,
  ensureDatabaseReady,
  messages,
} from "@workspace/db";
import {
  REBECCA_NARRATIVE_MEMORY_FACTS,
  REBECCA_NARRATIVE_MEMORY_NODES,
  seedEngrams,
  seedFullRezzArchive,
  seedRebeccaNarrativeMemories,
} from "@workspace/db/seed";
import { eq } from "drizzle-orm";

const ready = ensureDatabaseReady({ seed: false });

async function resetDatabase(): Promise<void> {
  await db.delete(engramWorldModelTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
}

async function loadRebecca() {
  const [rebecca] = await db
    .select()
    .from(engramsTable)
    .where(eq(engramsTable.slug, "rebecca"));
  if (!rebecca) throw new Error("base Rebecca was not seeded");
  return rebecca;
}

beforeAll(async () => {
  await ready;
});

beforeEach(async () => {
  await ready;
  await resetDatabase();
});

afterAll(async () => {
  await closeDb();
});

describe("base Rebecca narrative-simulation seed", () => {
  it("backfills the existing base row without changing its parameters", async () => {
    await seedEngrams(db);
    const before = await loadRebecca();
    const stableParameters = {
      voiceProfile: before.voiceProfile,
      emotionalBaseline: before.emotionalBaseline,
      environmentAnchor: before.environmentAnchor,
      guardrails: before.guardrails,
      drives: before.drives,
      focusThemes: before.focusThemes,
      autonomyEnabled: before.autonomyEnabled,
      tickCadenceSeconds: before.tickCadenceSeconds,
      initiationThreshold: before.initiationThreshold,
      mode: before.mode,
      humanContactEnabled: before.humanContactEnabled,
      simulationEnabled: before.simulationEnabled,
      artifactGenerationEnabled: before.artifactGenerationEnabled,
      isArchival: before.isArchival,
      driveState: before.driveState,
      currentMood: before.currentMood,
      isChatActive: before.isChatActive,
    };

    await db
      .update(engramsTable)
      .set({
        memorySeed: {
          ...before.memorySeed,
          facts: before.memorySeed.facts.filter(
            (fact) => !REBECCA_NARRATIVE_MEMORY_FACTS.includes(fact as never),
          ),
        },
      })
      .where(eq(engramsTable.id, before.id));

    await expect(seedRebeccaNarrativeMemories(db)).resolves.toEqual({
      nodesInserted: REBECCA_NARRATIVE_MEMORY_NODES.length,
      nodesTotal: REBECCA_NARRATIVE_MEMORY_NODES.length,
      memorySeedUpdated: true,
    });

    const after = await loadRebecca();
    expect({
      voiceProfile: after.voiceProfile,
      emotionalBaseline: after.emotionalBaseline,
      environmentAnchor: after.environmentAnchor,
      guardrails: after.guardrails,
      drives: after.drives,
      focusThemes: after.focusThemes,
      autonomyEnabled: after.autonomyEnabled,
      tickCadenceSeconds: after.tickCadenceSeconds,
      initiationThreshold: after.initiationThreshold,
      mode: after.mode,
      humanContactEnabled: after.humanContactEnabled,
      simulationEnabled: after.simulationEnabled,
      artifactGenerationEnabled: after.artifactGenerationEnabled,
      isArchival: after.isArchival,
      driveState: after.driveState,
      currentMood: after.currentMood,
      isChatActive: after.isChatActive,
    }).toEqual(stableParameters);
    expect(after.memorySeed.facts).toEqual([
      ...before.memorySeed.facts.filter(
        (fact) => !REBECCA_NARRATIVE_MEMORY_FACTS.includes(fact as never),
      ),
      ...REBECCA_NARRATIVE_MEMORY_FACTS,
    ]);
  });

  it("is idempotent and keeps every imported node private and simulated", async () => {
    await seedEngrams(db);
    await expect(seedRebeccaNarrativeMemories(db)).resolves.toMatchObject({
      nodesInserted: REBECCA_NARRATIVE_MEMORY_NODES.length,
      memorySeedUpdated: false,
    });

    const firstRows = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, (await loadRebecca()).id));
    expect(firstRows).toHaveLength(REBECCA_NARRATIVE_MEMORY_NODES.length);
    expect(firstRows.every((row) => row.provenance === "simulated")).toBe(true);
    expect(firstRows.every((row) => row.scope === "private")).toBe(true);
    expect(firstRows.every((row) => row.source?.startsWith("seed:rebecca-narrative-simulation:"))).toBe(
      true,
    );

    const beforeSecondRun = await loadRebecca();
    await expect(seedRebeccaNarrativeMemories(db)).resolves.toEqual({
      nodesInserted: 0,
      nodesTotal: REBECCA_NARRATIVE_MEMORY_NODES.length,
      memorySeedUpdated: false,
    });
    expect(await loadRebecca()).toEqual(beforeSecondRun);
    expect(
      await db
        .select()
        .from(engramWorldModelTable)
        .where(eq(engramWorldModelTable.engramId, beforeSecondRun.id)),
    ).toEqual(firstRows);
  });

  it("never touches the immutable Full Rezz branch", async () => {
    await seedEngrams(db);
    await seedFullRezzArchive(db);
    const [archiveBefore] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.slug, "rebecca-full-rezz"));
    const archiveNodesBefore = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, archiveBefore.id));

    await seedRebeccaNarrativeMemories(db);

    const [archiveAfter] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.slug, "rebecca-full-rezz"));
    const archiveNodesAfter = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, archiveAfter.id));
    expect(archiveAfter).toEqual(archiveBefore);
    expect(archiveNodesAfter).toEqual(archiveNodesBefore);

    const [baseRebecca] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.slug, "rebecca"));
    expect(baseRebecca.isArchival).toBe(false);
    expect(
      await db
        .select()
        .from(engramWorldModelTable)
        .where(eq(engramWorldModelTable.engramId, baseRebecca.id)),
    ).toHaveLength(REBECCA_NARRATIVE_MEMORY_NODES.length);
  });
});