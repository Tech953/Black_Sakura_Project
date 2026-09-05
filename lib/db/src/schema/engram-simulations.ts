import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { engramsTable } from "./engrams";
import { hubSpacesTable } from "./hub-spaces";
import { engramWorldModelTable } from "./engram-world-model";
import { SYSTEM_OWNER_ID } from "./accounts";

/**
 * Lifecycle of a bounded simulation an engram runs inside a simulation chamber:
 * - proposed: created but not yet advancing (awaiting a start, engine or operator).
 * - running: actively advancing one bounded step at a time.
 * - paused: temporarily halted by the operator; may be resumed.
 * - ended: finished (reached its step cap or was closed) — carries an exit summary.
 *
 * Status is set only by server-side logic (engine transitions + operator routes);
 * the model never proposes a status. Unknown values are treated as inert.
 */
export const SIMULATION_STATUSES = [
  "proposed",
  "running",
  "paused",
  "ended",
] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

/**
 * A single bounded simulation owned by one engram and anchored to a simulation
 * chamber space. The premise is the scenario being explored; the engram advances
 * it in discrete, capped steps. EVERYTHING produced inside a simulation is written
 * to the world-model with provenance "simulated" and never silently promoted to
 * observed reality — the chamber is a quarantined sandbox.
 */
export const engramSimulationsTable = pgTable(
  "engram_simulations",
  {
    id: serial("id").primaryKey(),
    /** Account that owns this durable job; copied from its engram at creation. */
    ownerId: text("owner_id").notNull().default(SYSTEM_OWNER_ID),
    engramId: integer("engram_id")
      .notNull()
      .references(() => engramsTable.id, { onDelete: "cascade" }),
    /** The simulation-chamber space this simulation runs inside. */
    spaceId: integer("space_id")
      .notNull()
      .references(() => hubSpacesTable.id),
    /** The scenario being explored, in the engram's framing. */
    premise: text("premise").notNull(),
    /** One of SIMULATION_STATUSES — set only by engine/operator logic, never the model. */
    status: text("status").notNull().default("proposed"),
    /** How many bounded steps have advanced so far. */
    currentStep: integer("current_step").notNull().default(0),
    /** Hard cap on steps; reaching it auto-ends the simulation with an exit summary. */
    maxSteps: integer("max_steps").notNull().default(5),
    /** Minimum gap between autonomous steps (cost/pacing guard). */
    stepCooldownSeconds: integer("step_cooldown_seconds").notNull().default(360),
    lastSteppedAt: timestamp("last_stepped_at", { withTimezone: true }),
    /** Reflection written when the simulation ends or is closed. */
    exitSummary: text("exit_summary"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("engram_simulations_engram_idx").on(t.engramId),
    index("engram_simulations_owner_idx").on(t.ownerId),
    index("engram_simulations_status_idx").on(t.status),
  ],
);

/**
 * One ordered step in a simulation's progress. Each step records the in-fiction
 * narrative the engram produced and links to the SIMULATED world-model entry it
 * spawned (nullable: the belief may be deleted independently without losing the
 * step's narrative trail).
 */
export const engramSimulationStepsTable = pgTable(
  "engram_simulation_steps",
  {
    id: serial("id").primaryKey(),
    simulationId: integer("simulation_id")
      .notNull()
      .references(() => engramSimulationsTable.id, { onDelete: "cascade" }),
    /** 1-based ordinal of this step within the simulation. */
    stepNumber: integer("step_number").notNull(),
    /** The in-fiction narrative produced for this step. */
    narrative: text("narrative").notNull(),
    /** The SIMULATED world-model entry this step produced, if still present. */
    worldModelEntryId: integer("world_model_entry_id").references(
      () => engramWorldModelTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("engram_simulation_steps_sim_idx").on(t.simulationId)],
);

export const insertEngramSimulationSchema = createInsertSchema(
  engramSimulationsTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertEngramSimulation = z.infer<typeof insertEngramSimulationSchema>;
export type EngramSimulation = typeof engramSimulationsTable.$inferSelect;
export type NewEngramSimulation = typeof engramSimulationsTable.$inferInsert;

export const insertEngramSimulationStepSchema = createInsertSchema(
  engramSimulationStepsTable,
).omit({ id: true, createdAt: true });
export type InsertEngramSimulationStep = z.infer<
  typeof insertEngramSimulationStepSchema
>;
export type EngramSimulationStep = typeof engramSimulationStepsTable.$inferSelect;
export type NewEngramSimulationStep = typeof engramSimulationStepsTable.$inferInsert;
