import { Router } from "express";
import type { EngramSimulation, EngramSimulationStep, SimulationStatus } from "@workspace/db";
import {
  ListSimulationsQueryParams,
  ListSimulationStepsParams,
  ControlSimulationParams,
  ControlSimulationBody,
} from "@workspace/api-zod";
import {
  loadSimulations,
  loadSimulationById,
  loadSimulationSteps,
} from "../lib/simulations-store";
import {
  applySimulationControl,
  kickSimulation,
  openOperatorSimulation,
  SimulationTransitionError,
} from "../lib/simulations";
import { loadSpaces, loadPresenceForEngram } from "../lib/hub-store";
import { loadControls } from "../lib/controls-store";
import { ARCHIVAL_READ_ONLY_ERROR, isArchivalEngram } from "../lib/archival";
import { loadOwnedEngram } from "../lib/account-bootstrap";

const router = Router();

function serializeSimulation(s: EngramSimulation) {
  return {
    id: s.id,
    engramId: s.engramId,
    spaceId: s.spaceId,
    premise: s.premise,
    status: s.status,
    currentStep: s.currentStep,
    maxSteps: s.maxSteps,
    stepCooldownSeconds: s.stepCooldownSeconds,
    lastSteppedAt: s.lastSteppedAt ? s.lastSteppedAt.toISOString() : null,
    exitSummary: s.exitSummary ?? null,
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    pausedAt: s.pausedAt ? s.pausedAt.toISOString() : null,
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializeStep(s: EngramSimulationStep) {
  return {
    id: s.id,
    simulationId: s.simulationId,
    stepNumber: s.stepNumber,
    narrative: s.narrative,
    worldModelEntryId: s.worldModelEntryId ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/simulations", async (req, res) => {
  const parsed = ListSimulationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    parsed.data.engramId != null &&
    !(await loadOwnedEngram(parsed.data.engramId, req.userId!))
  ) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  const rows = await loadSimulations({
    ownerId: req.userId!,
    engramId: parsed.data.engramId,
    status: parsed.data.status as SimulationStatus | undefined,
  });
  res.json(rows.map(serializeSimulation));
});

router.get("/simulations/:id/steps", async (req, res) => {
  const parsed = ListSimulationStepsParams.safeParse({ id: req.params.id });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const sim = await loadSimulationById(parsed.data.id, req.userId!);
  if (!sim) {
    res.status(404).json({ error: "Simulation not found" });
    return;
  }
  const steps = await loadSimulationSteps(sim.id);
  res.json(steps.map(serializeStep));
});

// Operator-directed simulation: open a running simulation for an engram with a
// specific scenario premise. Same quarantine as autonomous simulations — every
// generated beat is written with hardcoded provenance "simulated".
router.post("/simulations", async (req, res) => {
  const body = req.body as { engramId?: unknown; premise?: unknown; maxSteps?: unknown };
  const engramId = typeof body.engramId === "number" ? body.engramId : NaN;
  const premise = typeof body.premise === "string" ? body.premise.trim().slice(0, 1000) : "";
  const maxSteps =
    typeof body.maxSteps === "number" && Number.isFinite(body.maxSteps)
      ? Math.max(1, Math.round(body.maxSteps))
      : undefined;
  if (!Number.isInteger(engramId) || !premise) {
    res.status(400).json({ error: "engramId (integer) and premise (non-empty string) are required" });
    return;
  }
  const engram = await loadOwnedEngram(engramId, req.userId!);
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (engram.isArchival) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  const spaces = await loadSpaces(req.userId!);
  const chamber = spaces.find((s) => s.kind === "simulation_chamber");
  if (!chamber) {
    res.status(409).json({ error: "No simulation chamber space exists" });
    return;
  }
  const presence = await loadPresenceForEngram(engram.id, req.userId!);
  if (!presence || presence.spaceId !== chamber.id || presence.status !== "active") {
    res.status(409).json({
      error: `${engram.name} must be present in the simulation chamber ("${chamber.name}") to run a simulation — move them there first`,
    });
    return;
  }
  try {
    const controls = await loadControls(req.userId!);
    const sim = await openOperatorSimulation({ engram, chamber, premise, maxSteps, controls });
    // First beat immediately (best-effort, in the background) so the operator
    // doesn't wait for the next engine tick.
    void kickSimulation(sim);
    res.status(201).json(serializeSimulation(sim));
  } catch (err) {
    if (err instanceof SimulationTransitionError) {
      res.status(409).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(503).json({ error: "Failed to open simulation" });
  }
});

router.post("/simulations/:id/control", async (req, res) => {
  const parsedParams = ControlSimulationParams.safeParse({ id: req.params.id });
  const parsedBody = ControlSimulationBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const sim = await loadSimulationById(parsedParams.data.id, req.userId!);
  if (!sim) {
    res.status(404).json({ error: "Simulation not found" });
    return;
  }
  if (await isArchivalEngram(sim.engramId)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }
  try {
    const updated = await applySimulationControl(sim, parsedBody.data.action);
    // A manual start/resume shouldn't leave the operator staring at a stalled
    // sim until the next engine tick — generate the next beat now, best-effort.
    if (parsedBody.data.action === "start" || parsedBody.data.action === "resume") {
      void kickSimulation(updated);
    }
    res.json(serializeSimulation(updated));
  } catch (err) {
    if (err instanceof SimulationTransitionError) {
      res.status(400).json({ error: err.message });
      return;
    }
    req.log.error(err);
    res.status(503).json({ error: "Simulation control failed" });
  }
});

export default router;
