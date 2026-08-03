---
name: Engram synthesis (new personas from archive)
description: Invariants and couplings of the synthesize-new-engram feature and operator-directed simulations.
---

# Engram synthesis & operator-directed simulations

- **Provenance rule:** POST /engrams/synthesize grounds new personas ONLY in `observed`/`remembered` world-model entries. Simulated/inferred/desired content must never seed a real persona — keep the provenance filter in the route if refactoring.
- Synthesized config goes through `sanitizeSynthesizedEngram` (bounded, defaulted); the drive-naming coupling from engram-authoring.md applies — the prompt tells the model to use an outreach keyword in the top drive label if the persona should reach out.
- **Simulation stepping is CAS-guarded:** `claimSimulationStep` (simulations-store) atomically bumps currentStep with status=running; `advanceSimulation` claims BEFORE generating. Engine tick, `kickSimulation` (immediate beat on create/start/resume), and control requests may race — losers get null and skip. Never add a step write path that bypasses the claim.
- Orphaned running sims (engram left the chamber) auto-pause in the engine step phase instead of silently freezing.
- Self-initiation is drive-pressure-based, not cadence-bound: the engine may fire when a drive crosses threshold on any global tick; per-engram cadence only gates the routine persist-state write. Cooldown/backoff/rate caps/human-contact policy still bound frequency.

**Why:** an architect review found the pre-CAS kick path could duplicate step numbers (no unique constraint on (simulation_id, step_number) exists yet).
