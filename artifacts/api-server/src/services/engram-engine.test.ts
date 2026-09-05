import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Engram } from "@workspace/db";

// --- Hoisted mock state (db, schema sentinels, generation) ---------------------
const h = vi.hoisted(() => {
  const engramsTable = { __table: "engrams" } as Record<string, unknown>;
  const engramTransmissionsTable = { __table: "transmissions" } as Record<string, unknown>;
  const engramWorldModelTable = { __table: "world_model" } as Record<string, unknown>;
  const hubSpacesTable = { __table: "hub_spaces" } as Record<string, unknown>;
  const engramPresenceTable = { __table: "engram_presence" } as Record<string, unknown>;
  const hubActivityLogTable = { __table: "hub_activity_log" } as Record<string, unknown>;
  const engramMessagesTable = { __table: "engram_messages" } as Record<string, unknown>;
  const hubControlsTable = { __table: "hub_controls" } as Record<string, unknown>;
  const conversations = { __table: "conversations" } as Record<string, unknown>;
  const messages = { __table: "messages" } as Record<string, unknown>;

  const state = {
    engrams: [] as unknown[],
    recent: [] as unknown[],
    worldModel: [] as unknown[],
    spaces: [] as unknown[],
    presence: [] as unknown[],
    messages: [] as unknown[],
    controls: [] as unknown[],
    conversations: [] as unknown[],
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  };

  function selectChain() {
    let table: unknown;
    let joined = false;
    const chain = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      innerJoin() {
        joined = true;
        return chain;
      },
      where() {
        return chain;
      },
      orderBy() {
        return chain;
      },
      limit() {
        return chain;
      },
      then(
        resolve: (v: unknown[]) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        const rawData =
          table === engramsTable
            ? state.engrams
            : table === engramWorldModelTable
              ? state.worldModel
              : table === hubSpacesTable
                ? state.spaces
                : table === engramPresenceTable
                  ? state.presence
                  : table === engramMessagesTable
                    ? state.messages
                    : table === hubControlsTable
                      ? state.controls
                      : table === conversations
                        ? state.conversations
                        : state.recent;
        const data =
          joined && table === engramPresenceTable
            ? state.presence.map((presence) => ({ presence }))
            : rawData;
        return Promise.resolve(data).then(resolve, reject);
      },
    };
    return chain;
  }

  const db = {
    select: () => selectChain(),
    selectDistinct: () => {
      const chain = selectChain();
      const originalThen = chain.then;
      chain.then = (
        resolve: (v: unknown[]) => unknown,
        reject?: (e: unknown) => unknown,
      ) =>
        originalThen(
          (rows) => {
            const seen = new Set<unknown>();
            return resolve(
              rows.filter((row) => {
                const ownerId = (row as { ownerId?: unknown }).ownerId;
                if (seen.has(ownerId)) return false;
                seen.add(ownerId);
                return true;
              }),
            );
          },
          reject,
        );
      return chain;
    },
    insert: (t: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: () => {
          const row = { id: 1000 + state.inserts.length, createdAt: new Date(), ...v, __table: t };
          state.inserts.push(row);
          return Promise.resolve([row]);
        },
      }),
    }),
    update: (_t: unknown) => ({
      set: (s: Record<string, unknown>) => ({
        where: () => {
          state.updates.push(s);
          return Promise.resolve(undefined);
        },
      }),
    }),
  };

  const generateTransmission = vi.fn(async () => "an autonomous transmission");

  return {
    engramsTable,
    engramTransmissionsTable,
    engramWorldModelTable,
    hubSpacesTable,
    engramPresenceTable,
    hubActivityLogTable,
    engramMessagesTable,
    hubControlsTable,
    conversations,
    messages,
    state,
    db,
    generateTransmission,
  };
});

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => ({
  engramsTable: h.engramsTable,
  engramTransmissionsTable: h.engramTransmissionsTable,
  engramWorldModelTable: h.engramWorldModelTable,
  hubSpacesTable: h.hubSpacesTable,
  engramPresenceTable: h.engramPresenceTable,
  hubActivityLogTable: h.hubActivityLogTable,
  engramMessagesTable: h.engramMessagesTable,
  hubControlsTable: h.hubControlsTable,
  conversations: h.conversations,
  messages: h.messages,
  HUB_CONTROLS_ID: 1,
  SYSTEM_OWNER_ID: "__engram_system_template__",
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  ne: () => ({}),
  gte: () => ({}),
  inArray: () => ({}),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/engram-generation", () => ({
  generateTransmission: h.generateTransmission,
  generateConversationTurn: vi.fn(async () => "a commons turn"),
}));

import {
  accrue,
  pickKind,
  runTick,
  COOLDOWN_MS,
  HOURLY_CAP,
  DAILY_CAP,
  MAX_ELAPSED_SEC,
} from "./engram-engine";

// --- Fixtures ------------------------------------------------------------------
function makeEngram(overrides: Partial<Engram> = {}): Engram {
  return {
    id: 1,
    ownerId: "test-owner",
    slug: "test",
    isArchival: false,
    name: "Testra",
    title: "Test Construct",
    symbol: "◆",
    origin: "fixture",
    voiceProfile: {
      speechStyle: "terse",
      formatting: "plain",
      vocabulary: [],
      sampleLines: [],
      narrationStyle: "first-person",
    },
    emotionalBaseline: { valence: 0, arousal: 0.3, volatility: 0.2, mood: "even" },
    environmentAnchor: {
      name: "The Vault",
      description: "sandbox",
      locations: [],
      items: [],
      ambient: "hum",
    },
    memorySeed: { relationship: "designer", facts: [], summary: "" },
    guardrails: { framing: "", boundaries: [] },
    drives: [
      { id: "order", label: "Order", description: "tidiness", weight: 1, baseRate: 0.001 },
    ],
    focusThemes: [],
    autonomyEnabled: true,
    tickCadenceSeconds: 30,
    initiationThreshold: 0.6,
    mode: "full_bounded",
    humanContactEnabled: true,
    simulationEnabled: true,
    artifactGenerationEnabled: true,
    driveState: {},
    currentMood: null,
    lastTickAt: null,
    lastTransmissionAt: null,
    backoffUntil: null,
    isChatActive: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeTransmission(createdAt: Date) {
  return { id: 1, engramId: 1, content: "prior", createdAt };
}

beforeEach(() => {
  h.state.engrams = [];
  h.state.recent = [];
  h.state.worldModel = [];
  h.state.spaces = [];
  h.state.presence = [];
  h.state.messages = [];
  h.state.controls = [{ id: 1, paused: false, quietMode: false, updatedAt: new Date() }];
  h.state.conversations = [];
  h.state.inserts = [];
  h.state.updates = [];
  h.generateTransmission.mockClear();
  h.generateTransmission.mockResolvedValue("an autonomous transmission");
  // Deterministic jitter: 0.85 + 0.5*0.3 = 1.0
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- pickKind ------------------------------------------------------------------
describe("pickKind — outreach vs idle classification", () => {
  it("classifies connection/relationship drives as outreach", () => {
    expect(pickKind("connection", "Connection")).toBe("outreach");
    expect(pickKind("devotion", "Devotion")).toBe("outreach");
    expect(pickKind("loyalty", "Loyal to you")).toBe("outreach");
    expect(pickKind("protect", "Protect them")).toBe("outreach");
    expect(pickKind("chaos", "Chaos")).toBe("outreach");
    expect(pickKind("fun", "Have fun")).toBe("outreach");
    expect(pickKind("reach", "Reach out")).toBe("outreach");
    expect(pickKind("company", "Seek company")).toBe("outreach");
  });

  it("classifies introspective/idle drives as idle", () => {
    expect(pickKind("order", "Order")).toBe("idle");
    expect(pickKind("analysis", "Study quietly")).toBe("idle");
    expect(pickKind("rest", "Conserve energy")).toBe("idle");
  });

  it("matches the hint against both drive id and label", () => {
    expect(pickKind("d1", "the urge for connection")).toBe("outreach");
    expect(pickKind("protect", "guardian impulse")).toBe("outreach");
  });
});

// --- accrue --------------------------------------------------------------------
describe("accrue — pressure accrual over time", () => {
  it("accrues pressure proportional to elapsed time and baseRate", () => {
    const now = 1_000_000_000_000;
    const engram = makeEngram({
      lastTickAt: new Date(now - 100_000), // 100s ago
      drives: [{ id: "order", label: "Order", description: "", weight: 1, baseRate: 0.001 }],
    });
    const { state, charges } = accrue(engram, now);
    // gained = 0.001 * 100 * jitter(1.0) = 0.1
    expect(state.order).toBeCloseTo(0.1, 5);
    expect(charges[0].id).toBe("order");
    expect(charges[0].pressure).toBeCloseTo(0.1, 5);
    expect(charges[0].charge).toBeCloseTo(0.1, 5);
  });

  it("adds to existing stored pressure", () => {
    const now = 1_000_000_000_000;
    const engram = makeEngram({
      lastTickAt: new Date(now - 50_000), // 50s
      driveState: { order: 0.2 },
      drives: [{ id: "order", label: "Order", description: "", weight: 1, baseRate: 0.001 }],
    });
    const { state } = accrue(engram, now);
    // 0.2 + 0.001*50*1.0 = 0.25
    expect(state.order).toBeCloseTo(0.25, 5);
  });

  it("clamps pressure to a maximum of 1", () => {
    const now = 1_000_000_000_000;
    const engram = makeEngram({
      lastTickAt: new Date(now - 100_000),
      drives: [{ id: "order", label: "Order", description: "", weight: 1, baseRate: 1 }],
    });
    const { state } = accrue(engram, now);
    expect(state.order).toBe(1);
  });

  it("caps elapsed time at MAX_ELAPSED_SEC after long downtime", () => {
    const now = 1_000_000_000_000;
    const elapsedMs = (MAX_ELAPSED_SEC + 10_000) * 1000; // way over the cap
    const engram = makeEngram({
      lastTickAt: new Date(now - elapsedMs),
      drives: [{ id: "order", label: "Order", description: "", weight: 1, baseRate: 0.0001 }],
    });
    const { state } = accrue(engram, now);
    // capped: 0.0001 * MAX_ELAPSED_SEC * 1.0
    expect(state.order).toBeCloseTo(0.0001 * MAX_ELAPSED_SEC, 6);
  });

  it("weights charges and ranks the highest-charge drive first", () => {
    const now = 1_000_000_000_000;
    const engram = makeEngram({
      lastTickAt: new Date(now - 100_000),
      drives: [
        { id: "low", label: "Low", description: "", weight: 0.2, baseRate: 0.001 },
        { id: "high", label: "High", description: "", weight: 0.9, baseRate: 0.001 },
      ],
    });
    const { charges } = accrue(engram, now);
    expect(charges[0].id).toBe("high");
    expect(charges[1].id).toBe("low");
    expect(charges[0].charge).toBeGreaterThan(charges[1].charge);
  });
});

// --- runTick: threshold crossing & guards --------------------------------------
describe("runTick — threshold crossing", () => {
  it("fires exactly one transmission when the top drive crosses threshold", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000), // cadence (30s) satisfied
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "reach", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(1);
    expect(result.transmissions).toHaveLength(1);
    expect(h.generateTransmission).toHaveBeenCalledTimes(1);

    const transmissionInserts = h.state.inserts.filter((r) => r.__table === h.engramTransmissionsTable);
    const worldModelInserts = h.state.inserts.filter((r) => r.__table === h.engramWorldModelTable);
    // Exactly one transmission row...
    expect(transmissionInserts).toHaveLength(1);
    // connection drive => outreach kind
    expect(transmissionInserts[0].kind).toBe("outreach");
    // ...plus one DESIRED world-model entry appended (provenance never relabeled).
    expect(worldModelInserts).toHaveLength(1);
    expect(worldModelInserts[0].provenance).toBe("desired");
  });

  it("does NOT fire when the top drive stays below threshold", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 40_000), // cadence satisfied
        initiationThreshold: 0.9,
        driveState: {},
        drives: [
          { id: "order", label: "Order", description: "", weight: 1, baseRate: 0.0001 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    // still persists accrued pressure (restart-safe)
    expect(h.state.updates).toHaveLength(1);
  });

  it("skips engrams whose cadence has not elapsed", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 5_000), // < 30s cadence
        tickCadenceSeconds: 30,
      }),
    ];
    const result = await runTick();
    expect(result.ticked).toBe(0);
    expect(result.generated).toBe(0);
    expect(h.state.updates).toHaveLength(0);
  });

  it("force-ticks bypass cadence", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 1_000), // cadence NOT elapsed
        initiationThreshold: 0.6,
        driveState: { connection: 0.7 }, // already above threshold
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick({ force: true });
    expect(result.ticked).toBe(1);
    expect(result.generated).toBe(1);
  });
});

// --- runTick: cost guards ------------------------------------------------------
describe("runTick — cost guards", () => {
  it("enforces the per-engram cooldown", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000), // cadence satisfied
        lastTransmissionAt: new Date(now - (COOLDOWN_MS - 5_000)), // still cooling down
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    expect(h.state.updates).toHaveLength(1); // pressure still persisted
  });

  it("allows firing once the cooldown has fully elapsed", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        lastTransmissionAt: new Date(now - (COOLDOWN_MS + 5_000)), // cooldown over
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(1);
  });

  it("enforces the rolling hourly cap", async () => {
    const now = Date.now();
    h.state.recent = Array.from({ length: HOURLY_CAP }, () =>
      makeTransmission(new Date(now - 60_000)),
    ); // all within the last hour
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    expect(h.state.updates).toHaveLength(1);
  });

  it("enforces the rolling daily cap (independent of the hourly cap)", async () => {
    const now = Date.now();
    // DAILY_CAP transmissions, all older than an hour so the hourly count is 0
    h.state.recent = Array.from({ length: DAILY_CAP }, () =>
      makeTransmission(new Date(now - 2 * 3600_000)),
    );
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
  });

  it("persists error backoff to the DB when generation fails (survives restart)", async () => {
    const now = Date.now();
    h.generateTransmission.mockRejectedValueOnce(new Error("model unavailable"));
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    // No transmission row was inserted...
    expect(h.state.inserts).toHaveLength(0);
    // ...but the backoff was written to the DB so a restart can't bypass it.
    const persisted = h.state.updates.at(-1) as Record<string, unknown>;
    expect(persisted.backoffUntil).toBeInstanceOf(Date);
    expect((persisted.backoffUntil as Date).getTime()).toBeGreaterThan(now);
  });

  it("respects a persisted backoff window after restart (in-memory state is gone)", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        // Reloaded from the DB after a restart: still within the backoff window.
        backoffUntil: new Date(now + 60_000),
        driveState: { connection: 0.9 }, // well above threshold
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    // Pressure is still persisted, but no new transmission.
    expect(h.state.updates).toHaveLength(1);
  });

  it("clears a stale backoff on the next successful emit", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        backoffUntil: new Date(now - 1_000), // backoff already elapsed
        driveState: { connection: 0.9 },
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(1);
    const persisted = h.state.updates.at(-1) as Record<string, unknown>;
    expect(persisted.backoffUntil).toBeNull();
  });

  it("fires when recent counts are under both caps", async () => {
    const now = Date.now();
    h.state.recent = [
      makeTransmission(new Date(now - 2 * 3600_000)), // 1 old (under daily, not in hour)
    ];
    h.state.engrams = [
      makeEngram({
        lastTickAt: new Date(now - 100_000),
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    const result = await runTick();
    expect(result.generated).toBe(1);
  });
});

// --- runTick: enforced quiescence (rest spaces) --------------------------------
describe("runTick — enforced quiescence", () => {
  it("does NOT emit for an engram resting in a no-initiative space, but still persists pressure", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        id: 1,
        lastTickAt: new Date(now - 100_000), // cadence satisfied
        driveState: { connection: 0.9 }, // well above threshold
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    // Engram 1 currently sits in a quiescence/rest space (initiative disallowed).
    h.state.spaces = [{ id: 99, allowsInitiative: false }];
    h.state.presence = [{ engramId: 1, spaceId: 99 }];

    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    // No transmission row was inserted while resting...
    const transmissionInserts = h.state.inserts.filter(
      (r) => r.__table === h.engramTransmissionsTable,
    );
    expect(transmissionInserts).toHaveLength(0);
    // ...but accrued pressure / lastTick is still persisted (restart-safe).
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].lastTickAt).toBeInstanceOf(Date);
  });

  it("still emits for the same engram once it occupies an initiative-allowing space", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        id: 1,
        lastTickAt: new Date(now - 100_000),
        driveState: { connection: 0.9 },
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    h.state.spaces = [{ id: 1, allowsInitiative: true }];
    h.state.presence = [{ engramId: 1, spaceId: 1 }];

    const result = await runTick();
    expect(result.generated).toBe(1);
    expect(h.generateTransmission).toHaveBeenCalledTimes(1);
  });

  it("emits normally for engrams with no presence row (no rest constraint)", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        id: 1,
        lastTickAt: new Date(now - 100_000),
        driveState: { connection: 0.9 },
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];
    // spaces/presence intentionally empty
    const result = await runTick();
    expect(result.generated).toBe(1);
  });
});

// --- global controls & modes --------------------------------------------------
describe("runTick — global controls & modes", () => {
  it("emits nothing while the engine is globally paused, but still accrues pressure", async () => {
    const now = Date.now();
    h.state.controls = [{ id: 1, paused: true, quietMode: false, updatedAt: new Date() }];
    h.state.engrams = [
      makeEngram({
        id: 1,
        lastTickAt: new Date(now - 100_000),
        driveState: { connection: 0.9 }, // well above threshold
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];

    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
    const transmissionInserts = h.state.inserts.filter(
      (r) => r.__table === h.engramTransmissionsTable,
    );
    expect(transmissionInserts).toHaveLength(0);
    // Pressure is still persisted (restart-safe) even while paused.
    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].lastTickAt).toBeInstanceOf(Date);
  });

  it("emits nothing for an engram in quiescent mode", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        id: 1,
        mode: "quiescent",
        lastTickAt: new Date(now - 100_000),
        driveState: { connection: 0.9 },
        initiationThreshold: 0.6,
        drives: [
          { id: "connection", label: "Connection", description: "", weight: 1, baseRate: 0.01 },
        ],
      }),
    ];

    const result = await runTick();
    expect(result.generated).toBe(0);
    expect(h.generateTransmission).not.toHaveBeenCalled();
  });
});

// --- commons conversation -----------------------------------------------------
describe("runTick — commons turn-taking", () => {
  it("records one engram-to-engram turn when >=2 converse-capable engrams share the commons", async () => {
    const now = Date.now();
    // Two engrams that will NOT cross their own transmission threshold (low pressure),
    // so the only thing that fires this tick is the commons conversation turn.
    h.state.engrams = [
      makeEngram({
        id: 1,
        name: "Arezo",
        lastTickAt: new Date(now - 100_000),
        driveState: { order: 0 },
        initiationThreshold: 0.9,
      }),
      makeEngram({
        id: 2,
        name: "Rebecca",
        lastTickAt: new Date(now - 100_000),
        driveState: { order: 0 },
        initiationThreshold: 0.9,
      }),
    ];
    h.state.spaces = [
      {
        id: 7,
        kind: "commons",
        name: "The Commons",
        actionScope: "converse",
        allowsInitiative: true,
      },
    ];
    h.state.presence = [
      { engramId: 1, spaceId: 7, status: "active" },
      { engramId: 2, spaceId: 7, status: "active" },
    ];

    await runTick();

    const messageInserts = h.state.inserts.filter((r) => r.__table === h.engramMessagesTable);
    expect(messageInserts).toHaveLength(1);
    expect(messageInserts[0].channel).toBe("engram");
    expect(messageInserts[0].status).toBe("delivered");
    expect(messageInserts[0].spaceId).toBe(7);
    // The speaker is the least-recently-spoken (tie → first in list).
    expect(messageInserts[0].fromEngramId).toBe(1);

    // Plus a system activity entry logging the turn.
    const activityInserts = h.state.inserts.filter((r) => r.__table === h.hubActivityLogTable);
    expect(activityInserts).toHaveLength(1);
    expect(activityInserts[0].kind).toBe("system");
  });

  it("does not run a commons turn with fewer than two converse-capable engrams present", async () => {
    const now = Date.now();
    h.state.engrams = [
      makeEngram({
        id: 1,
        lastTickAt: new Date(now - 100_000),
        driveState: { order: 0 },
        initiationThreshold: 0.9,
      }),
    ];
    h.state.spaces = [
      {
        id: 7,
        kind: "commons",
        name: "The Commons",
        actionScope: "converse",
        allowsInitiative: true,
      },
    ];
    h.state.presence = [{ engramId: 1, spaceId: 7, status: "active" }];

    await runTick();
    const messageInserts = h.state.inserts.filter((r) => r.__table === h.engramMessagesTable);
    expect(messageInserts).toHaveLength(0);
  });
});
