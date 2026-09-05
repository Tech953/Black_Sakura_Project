import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRebeccaAdaptiveMemorySource,
  REBECCA_ADAPTIVE_MEMORY_NODES,
} from "@workspace/db/seed/rebecca-adaptive-data";
import {
  summarizeWorldModel,
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
} from "@workspace/engram-core";

const h = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
  legacyRebecca: {
    slug: "rebecca",
    name: "Rebecca",
    isArchival: false,
    voiceProfile: {
      speechStyle: "Brash and loyal.",
      formatting: "Cinematic.",
      vocabulary: ["choom", "operator phrase"],
      sampleLines: ["Original sample."],
      narrationStyle: "Fast.",
    },
    memorySeed: {
      relationship: "Existing relationship.",
      facts: ["Existing operator memory."],
      summary: "Existing summary.",
    },
    drives: [
      {
        id: "loyalty",
        label: "Loyalty / Protection",
        description: "Operator-customized loyalty description.",
        weight: 0.23,
        baseRate: 0.004,
      },
    ],
    focusThemes: ["operator-tuned theme"],
    driveState: { loyalty: 0.77 },
    currentMood: "operator-tuned",
  },
}));

const legacyRebecca = h.legacyRebecca;

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: h.openDatabaseAsync,
}));

vi.mock("@workspace/db/seed/engram-data", () => ({
  engramSeedData: [h.legacyRebecca],
}));

function createDatabase() {
  const state = {
    rebecca: {
      id: 1,
      slug: "rebecca",
      data: JSON.stringify(legacyRebecca),
      currentMood: "operator-tuned",
      isChatActive: 1,
      updatedAt: "2026-09-04T00:00:00.000Z",
    },
    archive: {
      id: 2,
      slug: "rebecca-full-rezz",
      data: JSON.stringify({ slug: "rebecca-full-rezz", isArchival: true }),
    },
    worldModel: [] as Array<{
      id: number;
      engramId: number;
      provenance: string;
      content: string;
      confidence: number;
      scope: string;
      source: string;
      createdAt: string;
      syncedAt: string;
    }>,
  };
  const database = {
    execAsync: vi.fn(async () => {}),
    runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.startsWith("UPDATE engrams SET data")) {
        state.rebecca.data = String(args[0]);
        state.rebecca.updatedAt = String(args[1]);
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (sql.includes("INSERT INTO world_model")) {
        state.worldModel.push({
          id: state.worldModel.length + 1,
          engramId: Number(args[0]),
          provenance: String(args[1]),
          content: String(args[2]),
          confidence: Number(args[3]),
          scope: "private",
          source: String(args[4]),
          createdAt: String(args[5]),
          syncedAt: String(args[6]),
        });
        return { lastInsertRowId: state.worldModel.length, changes: 1 };
      }
      return { lastInsertRowId: 0, changes: 0 };
    }),
    getFirstAsync: vi.fn(
      async (sql: string, value: unknown) => {
      if (!sql.includes("FROM engrams WHERE slug = ?")) return null;
      if (value === "rebecca") return state.rebecca;
      if (value === "rebecca-full-rezz") return state.archive;
      return null;
      },
    ),
    getAllAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      const engramId = Number(args[0]);
      if (sql.includes("source IN")) {
        const trustedSources = new Set(args.slice(1).map(String));
        return state.worldModel
          .filter(
            (node) =>
              node.engramId === engramId && trustedSources.has(node.source),
          )
          .sort((left, right) => right.id - left.id);
      }
      if (sql.includes("AND source = ?")) {
        return state.worldModel.filter(
          (node) =>
            node.engramId === engramId && node.source === String(args[1]),
        );
      }
      if (sql.includes("ORDER BY id DESC LIMIT ?")) {
        return state.worldModel
          .filter((node) => node.engramId === engramId)
          .sort((left, right) => right.id - left.id)
          .slice(0, Number(args[1]));
      }
      return [];
    }),
  };
  return { database, state };
}

describe("mobile Rebecca adaptive backfill", () => {
  beforeEach(() => {
    vi.resetModules();
    h.openDatabaseAsync.mockReset();
  });

  it("enriches an existing mutable profile once without resetting live or tuned values", async () => {
    const { database, state } = createDatabase();
    const archiveBefore = state.archive.data;
    h.openDatabaseAsync.mockResolvedValue(database);

    const firstStore = await import("./store");
    await firstStore.getDb();

    const enriched = JSON.parse(state.rebecca.data) as typeof legacyRebecca;
    expect(enriched.voiceProfile.vocabulary).toContain("operator phrase");
    expect(enriched.memorySeed.facts).toContain("Existing operator memory.");
    expect(enriched.drives.find((drive) => drive.id === "loyalty")).toMatchObject({
      description: "Operator-customized loyalty description.",
      weight: 0.23,
      baseRate: 0.004,
    });
    expect(enriched.drives.find((drive) => drive.id === "autonomy")).toBeDefined();
    expect(enriched.drives.find((drive) => drive.id === "adaptation")).toBeDefined();
    expect(enriched.focusThemes[0]).toBe("operator-tuned theme");
    expect(enriched.driveState).toEqual({ loyalty: 0.77 });
    expect(state.rebecca.currentMood).toBe("operator-tuned");
    expect(state.rebecca.isChatActive).toBe(1);
    expect(state.archive.data).toBe(archiveBefore);
    expect(state.worldModel).toHaveLength(REBECCA_ADAPTIVE_MEMORY_NODES.length);
    for (const node of REBECCA_ADAPTIVE_MEMORY_NODES) {
      expect(state.worldModel).toContainEqual(
        expect.objectContaining({
          engramId: 1,
          provenance: node.provenance,
          content: node.content,
          confidence: node.confidence,
          scope: "private",
          source: buildRebeccaAdaptiveMemorySource(node),
        }),
      );
    }
    expect(state.worldModel.every((node) => node.syncedAt === node.createdAt)).toBe(
      true,
    );
    const updatesAfterFirstOpen = database.runAsync.mock.calls.filter(([sql]) =>
      String(sql).startsWith("UPDATE engrams SET data"),
    ).length;
    expect(updatesAfterFirstOpen).toBe(1);

    vi.resetModules();
    const secondStore = await import("./store");
    await secondStore.getDb();
    expect(
      database.runAsync.mock.calls.filter(([sql]) =>
        String(sql).startsWith("UPDATE engrams SET data"),
      ),
    ).toHaveLength(updatesAfterFirstOpen);
    expect(state.worldModel).toHaveLength(REBECCA_ADAPTIVE_MEMORY_NODES.length);
  });

  it("fails closed when an existing mobile seed row has drifted", async () => {
    const { database, state } = createDatabase();
    const node = REBECCA_ADAPTIVE_MEMORY_NODES[0];
    state.worldModel.push({
      id: 1,
      engramId: 1,
      provenance: node.provenance,
      content: "tampered mobile seed",
      confidence: node.confidence,
      scope: "private",
      source: buildRebeccaAdaptiveMemorySource(node),
      createdAt: "2026-09-04T00:00:00.000Z",
      syncedAt: "2026-09-04T00:00:00.000Z",
    });
    h.openDatabaseAsync.mockResolvedValue(database);

    const store = await import("./store");
    await expect(store.getDb()).rejects.toThrow("noncanonical seeded row");
    expect(state.worldModel).toHaveLength(1);
    expect(state.worldModel[0].content).toBe("tampered mobile seed");
  });

  it("keeps canonical authority rows in offline prompts after forty newer observations", async () => {
    const { database, state } = createDatabase();
    h.openDatabaseAsync.mockResolvedValue(database);
    const store = await import("./store");
    await store.getDb();

    for (let index = 0; index < 45; index += 1) {
      state.worldModel.push({
        id: state.worldModel.length + 1,
        engramId: 1,
        provenance: "observed",
        content: `recent observation ${index}`,
        confidence: 1,
        scope: "private",
        source: `chat:${index}`,
        createdAt: `2026-09-04T00:01:${String(index).padStart(2, "0")}.000Z`,
        syncedAt: "",
      });
    }

    const loaded = await store.loadRecentWorldModel(1);
    expect(loaded).toHaveLength(48);
    expect(
      TRUSTED_REBECCA_ADAPTIVE_SOURCES.every((source) =>
        loaded.some((entry) => entry.source === source),
      ),
    ).toBe(true);
    const prompt = summarizeWorldModel(loaded);
    expect(prompt).toContain("Rebecca source authority (binding");
    expect(prompt.indexOf("PRIMARY DIALOGUE")).toBeLessThan(
      prompt.indexOf("CROSSOVER CONTINUITY"),
    );
  });

  it("fails closed on duplicate canonical mobile seed rows", async () => {
    const { database, state } = createDatabase();
    const node = REBECCA_ADAPTIVE_MEMORY_NODES[0];
    for (let id = 1; id <= 2; id += 1) {
      state.worldModel.push({
        id,
        engramId: 1,
        provenance: node.provenance,
        content: node.content,
        confidence: node.confidence,
        scope: "private",
        source: buildRebeccaAdaptiveMemorySource(node),
        createdAt: "2026-09-04T00:00:00.000Z",
        syncedAt: "2026-09-04T00:00:00.000Z",
      });
    }
    h.openDatabaseAsync.mockResolvedValue(database);

    const store = await import("./store");
    await expect(store.getDb()).rejects.toThrow("duplicate seeded rows");
  });
});