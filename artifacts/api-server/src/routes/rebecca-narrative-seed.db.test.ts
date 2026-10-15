import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});
import {
  closeDb,
  conversations,
  db,
  engramWorldModelTable,
  engramsTable,
  ensureDatabaseReady,
  messages,
  SYSTEM_OWNER_ID,
} from "@workspace/db";
import {
  buildRebeccaAdaptiveMemorySource,
  REBECCA_ADAPTIVE_MEMORY_FACTS,
  REBECCA_ADAPTIVE_MEMORY_NODES,
  REBECCA_ADAPTIVE_SOURCE_CATALOG,
  REBECCA_ADAPTIVE_SOURCE_AUTHORITIES,
  REBECCA_NARRATIVE_MEMORY_FACTS,
  REBECCA_NARRATIVE_MEMORY_NODES,
  seedEngrams,
  seedFullRezzArchive,
  seedRebeccaAdaptiveProfile,
  seedRebeccaNarrativeMemories,
} from "@workspace/db/seed";
import { and, eq } from "drizzle-orm";
import {
  summarizeWorldModel,
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
} from "../lib/world-model";
import { loadRecentWorldModel } from "../lib/world-model-store";

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

describe("base Rebecca adaptive source enrichment", () => {
  it("adds labeled source material without resetting live state or operator tuning", async () => {
    await seedEngrams(db);
    const before = await loadRebecca();
    const lastTickAt = new Date("2026-09-04T12:00:00.000Z");
    const lastTransmissionAt = new Date("2026-09-04T12:05:00.000Z");
    const backoffUntil = new Date("2026-09-04T12:10:00.000Z");
    const tunedDrives = [
      ...before.drives.map((drive) =>
        drive.id === "loyalty" ? { ...drive, weight: 0.31, baseRate: 0.004 } : drive,
      ),
      {
        id: "operator-custom",
        label: "Operator custom",
        description: "A deliberately retained operator-authored drive.",
        weight: 0.27,
        baseRate: 0.002,
      },
    ];
    const tunedVoice = {
      ...before.voiceProfile,
      vocabulary: [...before.voiceProfile.vocabulary, "operator phrase"],
    };

    await db
      .update(engramsTable)
      .set({
        voiceProfile: tunedVoice,
        drives: tunedDrives,
        focusThemes: ["operator-tuned theme"],
        driveState: { loyalty: 0.63, "operator-custom": 0.42 },
        currentMood: "operator-tuned",
        lastTickAt,
        lastTransmissionAt,
        backoffUntil,
        isChatActive: true,
      })
      .where(eq(engramsTable.id, before.id));
    const [conversation] = await db
      .insert(conversations)
      .values({
        title: "Existing Rebecca conversation",
        engramId: before.id,
      })
      .returning();
    await db.insert(messages).values({
      conversationId: conversation.id,
      role: "user",
      content: "Keep this conversation intact.",
    });
    const conversationBefore = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id));
    const messagesBefore = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));

    await expect(seedRebeccaAdaptiveProfile(db)).resolves.toEqual({
      nodesInserted: REBECCA_ADAPTIVE_MEMORY_NODES.length,
      nodesTotal: REBECCA_ADAPTIVE_MEMORY_NODES.length,
      profileUpdated: true,
    });

    const after = await loadRebecca();
    expect(after.driveState).toEqual({ loyalty: 0.63, "operator-custom": 0.42 });
    expect(after.currentMood).toBe("operator-tuned");
    expect(after.lastTickAt).toEqual(lastTickAt);
    expect(after.lastTransmissionAt).toEqual(lastTransmissionAt);
    expect(after.backoffUntil).toEqual(backoffUntil);
    expect(after.isChatActive).toBe(true);
    expect(after.voiceProfile.vocabulary).toContain("operator phrase");
    expect(after.focusThemes[0]).toBe("operator-tuned theme");
    expect(after.drives.find((drive) => drive.id === "loyalty")).toMatchObject({
      weight: 0.31,
      baseRate: 0.004,
    });
    expect(after.drives.find((drive) => drive.id === "operator-custom")).toEqual(
      tunedDrives.at(-1),
    );
    expect(after.drives.find((drive) => drive.id === "autonomy")).toMatchObject({
      label: "Self-Determination / Moral Judgment",
    });
    expect(after.drives.find((drive) => drive.id === "adaptation")).toMatchObject({
      label: "Curiosity / Adaptive Learning",
    });
    for (const fact of REBECCA_ADAPTIVE_MEMORY_FACTS) {
      expect(after.memorySeed.facts).toContain(fact);
    }
    expect(
      await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversation.id)),
    ).toEqual(conversationBefore);
    expect(
      await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, conversation.id)),
    ).toEqual(messagesBefore);

    const nodes = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, after.id));
    expect(nodes).toHaveLength(REBECCA_ADAPTIVE_MEMORY_NODES.length);
    for (const expected of REBECCA_ADAPTIVE_MEMORY_NODES) {
      const sourceFragment =
        `:${expected.authority}:${expected.sourceIds.join("+")}:` +
        expected.slug;
      const actual = nodes.find((node) => node.source?.endsWith(sourceFragment));
      expect(actual).toMatchObject({
        provenance: expected.provenance,
        content: expected.content,
        confidence: expected.confidence,
        scope: "private",
      });
    }
    expect(new Set(REBECCA_ADAPTIVE_MEMORY_NODES.map((node) => node.authority))).toEqual(
      new Set(REBECCA_ADAPTIVE_SOURCE_AUTHORITIES),
    );
    expect(REBECCA_ADAPTIVE_SOURCE_CATALOG).toHaveLength(6);
    expect(
      REBECCA_ADAPTIVE_SOURCE_CATALOG.filter(
        (source) => source.authority === "primary-dialogue",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "edgerunners-dialogue-asr",
        fidelity: "uncertain-transcription",
      }),
    ]);
    expect(
      REBECCA_ADAPTIVE_SOURCE_CATALOG.filter(
        (source) => source.authority === "contextual-lore",
      ),
    ).toEqual([
      expect.objectContaining({
        id: "edgerunners-mission-kit-lore",
        fidelity: "third-party-summary",
      }),
    ]);
    expect(
      REBECCA_ADAPTIVE_SOURCE_CATALOG.filter(
        (source) => source.authority === "crossover-continuity",
      ),
    ).toHaveLength(4);
    expect(
      new Set(REBECCA_ADAPTIVE_MEMORY_NODES.flatMap((node) => node.sourceIds)),
    ).toEqual(new Set(REBECCA_ADAPTIVE_SOURCE_CATALOG.map((source) => source.id)));
    expect(
      new Set(
        REBECCA_ADAPTIVE_MEMORY_NODES.map(
          (node) =>
            `seed:rebecca-adaptive:v1:${node.authority}:` +
            `${node.sourceIds.join("+")}:${node.slug}`,
        ),
      ),
    ).toEqual(new Set(TRUSTED_REBECCA_ADAPTIVE_SOURCES));
  });

  it("is stable when the adaptive seed runs more than once", async () => {
    await seedEngrams(db);
    await seedRebeccaAdaptiveProfile(db);
    const beforeSecondRun = await loadRebecca();
    const nodesBefore = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, beforeSecondRun.id));

    await expect(seedRebeccaAdaptiveProfile(db)).resolves.toEqual({
      nodesInserted: 0,
      nodesTotal: REBECCA_ADAPTIVE_MEMORY_NODES.length,
      profileUpdated: false,
    });

    expect(await loadRebecca()).toEqual(beforeSecondRun);
    expect(
      await db
        .select()
        .from(engramWorldModelTable)
        .where(eq(engramWorldModelTable.engramId, beforeSecondRun.id)),
    ).toEqual(nodesBefore);
  });

  it("enriches only the system template when an account also has Rebecca", async () => {
    await seedEngrams(db);
    const systemRebecca = await loadRebecca();
    const {
      id: _id,
      ownerId: _ownerId,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...template
    } = systemRebecca;
    const [accountRebecca] = await db
      .insert(engramsTable)
      .values({
        ...template,
        ownerId: "account-a",
        currentMood: "account-owned-mood",
      })
      .returning();

    await expect(seedRebeccaAdaptiveProfile(db)).resolves.toMatchObject({
      nodesInserted: REBECCA_ADAPTIVE_MEMORY_NODES.length,
    });

    const systemRows = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, systemRebecca.id));
    const accountRows = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, accountRebecca.id));
    const [unchangedAccountRebecca] = await db
      .select()
      .from(engramsTable)
      .where(
        and(
          eq(engramsTable.ownerId, "account-a"),
          eq(engramsTable.slug, "rebecca"),
        ),
      );

    expect(systemRebecca.ownerId).toBe(SYSTEM_OWNER_ID);
    expect(systemRows).toHaveLength(REBECCA_ADAPTIVE_MEMORY_NODES.length);
    expect(accountRows).toEqual([]);
    expect(unchangedAccountRebecca.currentMood).toBe("account-owned-mood");
  });

  it("ignores duplicate ordinary source labels while seeding canonical rows", async () => {
    await seedEngrams(db);
    const rebecca = await loadRebecca();
    await db.insert(engramWorldModelTable).values([
      {
        engramId: rebecca.id,
        provenance: "remembered",
        content: "first operator memory",
        confidence: 0.8,
        scope: "private",
        source: "manual",
      },
      {
        engramId: rebecca.id,
        provenance: "inferred",
        content: "second operator memory",
        confidence: 0.5,
        scope: "private",
        source: "manual",
      },
    ]);

    await expect(seedRebeccaAdaptiveProfile(db)).resolves.toMatchObject({
      nodesInserted: REBECCA_ADAPTIVE_MEMORY_NODES.length,
    });
    const rows = await db
      .select()
      .from(engramWorldModelTable)
      .where(eq(engramWorldModelTable.engramId, rebecca.id));
    expect(rows.filter((row) => row.source === "manual")).toHaveLength(2);
  });

  it("fails closed on duplicate canonical adaptive source keys", async () => {
    await seedEngrams(db);
    const rebecca = await loadRebecca();
    const node = REBECCA_ADAPTIVE_MEMORY_NODES[0];
    const canonical = {
      engramId: rebecca.id,
      provenance: node.provenance,
      content: node.content,
      confidence: node.confidence,
      scope: "private" as const,
      source: buildRebeccaAdaptiveMemorySource(node),
    };
    await db.insert(engramWorldModelTable).values([canonical, canonical]);

    await expect(seedRebeccaAdaptiveProfile(db)).rejects.toThrow(
      "duplicate seeded rows",
    );
  });

  it("keeps canonical authority rows in server prompts after forty newer observations", async () => {
    await seedEngrams(db);
    await seedRebeccaAdaptiveProfile(db);
    const rebecca = await loadRebecca();
    await db.insert(engramWorldModelTable).values(
      Array.from({ length: 45 }, (_, index) => ({
        engramId: rebecca.id,
        provenance: "observed" as const,
        content: `newer observation ${index}`,
        confidence: 1,
        scope: "private" as const,
        source: `chat:${index}`,
        createdAt: new Date(`2030-01-01T00:00:${String(index).padStart(2, "0")}.000Z`),
      })),
    );

    const loaded = await loadRecentWorldModel(rebecca.id);
    expect(loaded).toHaveLength(48);
    expect(
      TRUSTED_REBECCA_ADAPTIVE_SOURCES.every((source) =>
        loaded.some((entry) => entry.source === source),
      ),
    ).toBe(true);
    const prompt = summarizeWorldModel(loaded, {
      perProvenance: 40,
      total: REBECCA_ADAPTIVE_MEMORY_NODES.length,
    });
    expect(prompt).toContain("Rebecca source authority (binding");
    expect(prompt).not.toContain("newer observation");
  });

  it("leaves the Full Rezz engram and transcript byte-for-byte unchanged", async () => {
    await seedEngrams(db);
    await seedFullRezzArchive(db);
    const [archiveBefore] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.slug, "rebecca-full-rezz"));
    const archiveConversationsBefore = await db
      .select()
      .from(conversations)
      .where(eq(conversations.engramId, archiveBefore.id));
    const archiveMessagesBefore = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, archiveConversationsBefore[0].id));

    await seedRebeccaAdaptiveProfile(db);

    const [archiveAfter] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.slug, "rebecca-full-rezz"));
    expect(archiveAfter).toEqual(archiveBefore);
    expect(
      await db
        .select()
        .from(conversations)
        .where(eq(conversations.engramId, archiveBefore.id)),
    ).toEqual(archiveConversationsBefore);
    expect(
      await db
        .select()
        .from(messages)
        .where(eq(messages.conversationId, archiveConversationsBefore[0].id)),
    ).toEqual(archiveMessagesBefore);
    expect(
      await db
        .select()
        .from(engramWorldModelTable)
        .where(eq(engramWorldModelTable.engramId, archiveBefore.id)),
    ).toEqual([]);
  });

  it("fails closed if a seeded source was relabeled or rewritten", async () => {
    await seedEngrams(db);
    const rebecca = await loadRebecca();
    const expected = REBECCA_ADAPTIVE_MEMORY_NODES[0];
    await db.insert(engramWorldModelTable).values({
      engramId: rebecca.id,
      provenance: "observed",
      content: "tampered source",
      confidence: expected.confidence,
      scope: "private",
      source:
        `seed:rebecca-adaptive:v1:${expected.authority}:` +
        `${expected.sourceIds.join("+")}:${expected.slug}`,
    });

    await expect(seedRebeccaAdaptiveProfile(db)).rejects.toThrow(
      "noncanonical seeded row",
    );
  });
});