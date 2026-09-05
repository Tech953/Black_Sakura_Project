import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Engram, EngramSimulation, EngramPresence, HubSpace } from "@workspace/db";
import type { GlobalControls } from "./engram-policy";

// --- Hoisted mock state -------------------------------------------------------
// We mock the stores + generation seam + side-effect modules, but keep the REAL
// (pure) policy (engram-policy) and world-model summarizer so canSimulate gating
// is genuinely exercised. loadEngramRow in endSimulation hits db directly, so the
// db mock just needs to return the engram row for the cap-end exit-summary path.
const h = vi.hoisted(() => {
  const engramsTable = { __table: "engrams" } as Record<string, unknown>;
  const state = { engramRow: null as unknown };
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.engramRow ? [state.engramRow] : []),
      }),
    }),
  };
  return {
    engramsTable,
    state,
    db,
    appendSimulationStep: vi.fn(async () => ({ id: 1 })),
    createSimulation: vi.fn(async (v: Record<string, unknown>) => ({ id: 7, ...v })),
    loadActiveSimulationForEngram: vi.fn(async () => null as EngramSimulation | null),
    loadRunningSimulations: vi.fn(async () => [] as EngramSimulation[]),
    loadSimulationSteps: vi.fn(async () => [] as { narrative: string }[]),
     updateSimulation: vi.fn(
       async (id: number, _ownerId: string, patch: Record<string, unknown>) => ({
         id,
         ...patch,
       }),
     ),
     claimSimulationStep: vi.fn(
       async (
         id: number,
         ownerId: string,
         expectedCurrentStep: number,
         now: Date,
       ) => ({
      id,
         ownerId,
      currentStep: expectedCurrentStep + 1,
      lastSteppedAt: now,
      status: "running",
       }),
     ),
    generateSimulationPremise: vi.fn(async () => "What if the vault flooded?"),
    generateSimulationStep: vi.fn(async () => "The water rises another inch."),
    generateSimulationExitSummary: vi.fn(async () => "I learned the drains hold."),
    loadRecentWorldModel: vi.fn(async () => [] as unknown[]),
    appendActivity: vi.fn(async () => undefined),
  };
});

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => ({ engramsTable: h.engramsTable }));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("./simulations-store", () => ({
  appendSimulationStep: h.appendSimulationStep,
  createSimulation: h.createSimulation,
  loadActiveSimulationForEngram: h.loadActiveSimulationForEngram,
  loadRunningSimulations: h.loadRunningSimulations,
  loadSimulationSteps: h.loadSimulationSteps,
  updateSimulation: h.updateSimulation,
  claimSimulationStep: h.claimSimulationStep,
}));
vi.mock("./engram-generation", () => ({
  generateSimulationPremise: h.generateSimulationPremise,
  generateSimulationStep: h.generateSimulationStep,
  generateSimulationExitSummary: h.generateSimulationExitSummary,
}));
vi.mock("./world-model-store", () => ({ loadRecentWorldModel: h.loadRecentWorldModel }));
vi.mock("./hub-store", () => ({ appendActivity: h.appendActivity }));

import { maybeRunSimulationStep, SIMULATION_STEP_CONFIDENCE } from "./simulations";

// --- Fixtures -----------------------------------------------------------------
const CHAMBER: HubSpace = {
  id: 5,
  slug: "chamber",
  name: "Simulation Chamber",
  kind: "simulation_chamber",
  description: "where engrams run hypotheticals",
  allowsInitiative: true,
  actionScope: "simulate",
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as HubSpace;

function makeEngram(overrides: Partial<Engram> = {}): Engram {
  return {
    id: 1,
    ownerId: "test-owner",
    slug: "test",
    name: "Testra",
    title: "Test Construct",
    mode: "simulation",
    humanContactEnabled: true,
    simulationEnabled: true,
    artifactGenerationEnabled: true,
    drives: [],
    emotionalBaseline: { valence: 0, arousal: 0.3, volatility: 0.2, mood: "even" },
    currentMood: null,
    ...overrides,
  } as unknown as Engram;
}

function makeSim(overrides: Partial<EngramSimulation> = {}): EngramSimulation {
  return {
    id: 7,
    ownerId: "test-owner",
    engramId: 1,
    spaceId: CHAMBER.id,
    premise: "What if the vault flooded?",
    status: "running",
    currentStep: 0,
    maxSteps: 5,
    stepCooldownSeconds: 360,
    exitSummary: null,
    startedAt: new Date(),
    pausedAt: null,
    endedAt: null,
    lastSteppedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as EngramSimulation;
}

function makeOpts(opts: {
  engrams: Engram[];
  spaces?: HubSpace[];
  presence?: EngramPresence[];
  controls?: GlobalControls;
  now?: number;
}) {
  const spaces = opts.spaces ?? [CHAMBER];
  const presence =
    opts.presence ??
    opts.engrams.map(
      (e) =>
        ({ engramId: e.id, spaceId: CHAMBER.id, status: "active" }) as unknown as EngramPresence,
    );
  return {
    controls: opts.controls ?? ({ paused: false, quietMode: false } as GlobalControls),
    engrams: opts.engrams,
    spaceById: new Map(spaces.map((s) => [s.id, s])),
    presenceByEngram: new Map(presence.map((p) => [p.engramId, p])),
    now: opts.now ?? Date.now(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.engramRow = makeEngram();
  h.loadActiveSimulationForEngram.mockResolvedValue(null);
  h.loadRunningSimulations.mockResolvedValue([]);
  h.loadSimulationSteps.mockResolvedValue([]);
});

// --- Stepping a running simulation --------------------------------------------
describe("maybeRunSimulationStep — stepping", () => {
  it("advances a running sim by one bounded step, writing only via appendSimulationStep", async () => {
    h.loadRunningSimulations.mockResolvedValue([makeSim({ currentStep: 1 })]);
    const engram = makeEngram();

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [engram] }));

    expect(out).toEqual({ kind: "stepped", simulationId: 7 });
    expect(h.generateSimulationStep).toHaveBeenCalledTimes(1);
    // The SOLE world-model write path: provenance is hardcoded "simulated" inside
    // appendSimulationStep, and the engine never calls any other append.
    expect(h.appendSimulationStep).toHaveBeenCalledTimes(1);
    expect(h.appendSimulationStep).toHaveBeenCalledWith(
      expect.objectContaining({ stepNumber: 2, confidence: SIMULATION_STEP_CONFIDENCE }),
    );
    // The step counter is bumped atomically via the CAS claim, not a blind update.
    expect(h.claimSimulationStep).toHaveBeenCalledWith(
      7,
      "test-owner",
      1,
      expect.any(Date),
    );
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
  });

  it("respects the per-step cooldown (does not step a recently-stepped sim)", async () => {
    const now = Date.now();
    // Stepped 1 minute ago; cooldown is 360s, so it must wait.
    h.loadRunningSimulations.mockResolvedValue([
      makeSim({ currentStep: 1, lastSteppedAt: new Date(now - 60_000) }),
    ]);
    // An active sim exists, so the propose phase is also skipped.
    h.loadActiveSimulationForEngram.mockResolvedValue(makeSim({ currentStep: 1 }));

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [makeEngram()], now }));

    expect(out).toBeNull();
    expect(h.generateSimulationStep).not.toHaveBeenCalled();
    expect(h.appendSimulationStep).not.toHaveBeenCalled();
  });
});

// --- Bounds: stop at maxSteps -------------------------------------------------
describe("maybeRunSimulationStep — bounds", () => {
  it("auto-ends the sim with an exit summary when it reaches maxSteps", async () => {
    h.loadRunningSimulations.mockResolvedValue([makeSim({ currentStep: 4, maxSteps: 5 })]);

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [makeEngram()] }));

    expect(out).toEqual({ kind: "ended", simulationId: 7 });
    expect(h.generateSimulationExitSummary).toHaveBeenCalledTimes(1);
    // Last update flips status to ended.
    const lastCall = h.updateSimulation.mock.calls.at(-1);
    expect(lastCall?.[2]).toEqual(expect.objectContaining({ status: "ended" }));
  });

  it("clamps the effective step ceiling to the hard cap of 10", async () => {
    // maxSteps requested = 20, but the hard cap is 10, so step 10 ends it.
    h.loadRunningSimulations.mockResolvedValue([makeSim({ currentStep: 9, maxSteps: 20 })]);

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [makeEngram()] }));

    expect(out).toEqual({ kind: "ended", simulationId: 7 });
    expect(h.generateSimulationExitSummary).toHaveBeenCalledTimes(1);
  });
});

// --- Proposing a new simulation -----------------------------------------------
describe("maybeRunSimulationStep — proposing", () => {
  it("opens a new running sim for a capable, present engram with no active sim", async () => {
    const out = await maybeRunSimulationStep(makeOpts({ engrams: [makeEngram()] }));

    expect(out).toEqual({ kind: "created", simulationId: 7 });
    expect(h.generateSimulationPremise).toHaveBeenCalledTimes(1);
    expect(h.createSimulation).toHaveBeenCalledWith(
      expect.objectContaining({ engramId: 1, spaceId: CHAMBER.id, status: "running" }),
    );
    // Creating is not stepping.
    expect(h.generateSimulationStep).not.toHaveBeenCalled();
  });

  it("does not propose when the engram already has an active sim", async () => {
    h.loadActiveSimulationForEngram.mockResolvedValue(makeSim({ status: "paused" }));

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [makeEngram()] }));

    expect(out).toBeNull();
    expect(h.createSimulation).not.toHaveBeenCalled();
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
  });

  it("returns null when there is no simulation chamber", async () => {
    const out = await maybeRunSimulationStep(
      makeOpts({ engrams: [makeEngram()], spaces: [] }),
    );

    expect(out).toBeNull();
    expect(h.loadRunningSimulations).not.toHaveBeenCalled();
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
  });
});

// --- Overrides: no LLM / no world-model write ---------------------------------
describe("maybeRunSimulationStep — overrides short-circuit before any model call", () => {
  it("a global pause blocks both stepping and proposing (no LLM, no write)", async () => {
    h.loadRunningSimulations.mockResolvedValue([makeSim({ currentStep: 1 })]);

    const out = await maybeRunSimulationStep(
      makeOpts({
        engrams: [makeEngram()],
        controls: { paused: true, quietMode: false },
      }),
    );

    expect(out).toBeNull();
    expect(h.generateSimulationStep).not.toHaveBeenCalled();
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
    expect(h.appendSimulationStep).not.toHaveBeenCalled();
    expect(h.createSimulation).not.toHaveBeenCalled();
  });

  it("a per-engram simulationEnabled=false blocks both stepping and proposing", async () => {
    h.loadRunningSimulations.mockResolvedValue([makeSim({ currentStep: 1 })]);
    const engram = makeEngram({ simulationEnabled: false });

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [engram] }));

    expect(out).toBeNull();
    expect(h.generateSimulationStep).not.toHaveBeenCalled();
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
    expect(h.appendSimulationStep).not.toHaveBeenCalled();
    expect(h.createSimulation).not.toHaveBeenCalled();
  });

  it("a quiescent mode fails closed (no simulation)", async () => {
    const engram = makeEngram({ mode: "quiescent" });

    const out = await maybeRunSimulationStep(makeOpts({ engrams: [engram] }));

    expect(out).toBeNull();
    expect(h.generateSimulationPremise).not.toHaveBeenCalled();
    expect(h.createSimulation).not.toHaveBeenCalled();
  });
});
