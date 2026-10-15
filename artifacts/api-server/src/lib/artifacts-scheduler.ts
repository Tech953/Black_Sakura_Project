import type { Engram, EngramArtifact, EngramPresence, HubSpace } from "@workspace/db";
import { logger } from "./logger";
import { capabilitiesFor, type GlobalControls } from "./engram-policy";
import {
  createArtifactJob,
  countArtifactsSince,
  loadLastAutonomousArtifactAt,
} from "./artifact-store";

// --- Cost & cadence guards for AUTONOMOUS generation (operator "create now" is uncapped here). ---
/** Minimum gap between an engram's own autonomous artifacts. */
export const ARTIFACT_AUTONOMOUS_COOLDOWN_MS = 6 * 3600_000; // 6h
/** Max autonomous artifacts per engram per rolling day (counts every trigger=autonomous row). */
export const ARTIFACT_AUTONOMOUS_DAILY_CAP = 2;

/**
 * Resolve, through the single policy keystone, whether an engram present in a studio
 * may autonomously generate. Mirrors `canEngramSimulate` in simulations.ts.
 */
function canEngramGenerate(
  engram: Engram,
  space: HubSpace,
  controls: GlobalControls,
): boolean {
  return capabilitiesFor({
    mode: engram.mode,
    controls,
    space: { allowsInitiative: space.allowsInitiative, actionScope: space.actionScope },
    humanContactEnabled: engram.humanContactEnabled,
    simulationEnabled: engram.simulationEnabled,
    artifactGenerationEnabled: engram.artifactGenerationEnabled,
  }).canGenerateArtifacts;
}

/**
 * Frame a bounded document brief from the engram's persona. The WORKER recalls the
 * world model and authors the actual content; here we only set a title + intent, so
 * this stays a pure, DB-free helper.
 */
function buildDocumentBrief(engram: Engram): { title: string; prompt: string } {
  const themes = engram.focusThemes?.slice(0, 3).join(", ");
  const topDrive = engram.drives?.[0]?.label;
  const intent = [
    `A short reflective document authored entirely in ${engram.name}'s own voice.`,
    topDrive ? `Let it surface from the "${topDrive}" drive.` : "",
    themes ? `Draw on recurring concerns: ${themes}.` : "",
    "This is the engram's own work — not a reply to anyone, not addressed to a reader.",
  ]
    .filter(Boolean)
    .join(" ");
  return { title: `${engram.name} — a reflection`, prompt: intent };
}

/**
 * Autonomous artifact phase — the generation mirror of `maybeRunSimulationStep`.
 *
 * At most ONE artifact is enqueued per tick (globally). An engram is eligible only
 * when it is present + active in a `studio` (generate-scoped) space AND the pure
 * policy grants `canGenerateArtifacts` (full_bounded mode + per-engram toggle, all
 * fail-closed under pause/rest/quiescence). Eligible engrams are then filtered by a
 * per-engram cooldown and a strict rolling-day cap, and the least-recently-generated
 * one is picked.
 *
 * The enqueued job is ALWAYS a PDF (document): always-local, zero-cost, offline-safe.
 * Cost-incurring image/video generation is intentionally NOT reachable from this
 * autonomous path — it stays operator-consented via the studio "create now" route.
 * The provenance/kind/trigger here are hardcoded; model output never chooses them.
 *
 * The existing artifact worker picks the queued job up and generates it; this phase
 * only decides *whether* and *for whom* to enqueue.
 */
export async function maybeRunArtifactGeneration(opts: {
  controls: GlobalControls;
  engrams: Engram[];
  spaceById: Map<number, HubSpace>;
  presenceByEngram: Map<number, EngramPresence>;
  now: number;
}): Promise<EngramArtifact | null> {
  const { controls, engrams, spaceById, presenceByEngram, now } = opts;

  const studio = [...spaceById.values()].find((s) => s.kind === "studio");
  if (!studio) return null;

  // Engrams physically present + active in the studio that policy allows to generate.
  const eligible = engrams.filter((engram) => {
    const presence = presenceByEngram.get(engram.id);
    if (!presence || presence.spaceId !== studio.id || presence.status !== "active") {
      return false;
    }
    return canEngramGenerate(engram, studio, controls);
  });
  if (eligible.length === 0) return null;

  const lastById = await loadLastAutonomousArtifactAt(eligible.map((e) => e.id));

  // Cooldown + rolling-day cap filter.
  const ready: Engram[] = [];
  for (const engram of eligible) {
    const last = lastById.get(engram.id);
    if (last && now - last.getTime() < ARTIFACT_AUTONOMOUS_COOLDOWN_MS) continue;
    const dayCount = await countArtifactsSince(
      engram.id,
      new Date(now - 24 * 3600_000),
      "autonomous",
    );
    if (dayCount >= ARTIFACT_AUTONOMOUS_DAILY_CAP) continue;
    ready.push(engram);
  }
  if (ready.length === 0) return null;

  // Fair scheduling: least-recently-generated first (never-generated sorts to the front).
  ready.sort(
    (a, b) => (lastById.get(a.id)?.getTime() ?? 0) - (lastById.get(b.id)?.getTime() ?? 0),
  );
  const engram = ready[0];

  const { title, prompt } = buildDocumentBrief(engram);
  const job = await createArtifactJob({
    ownerId: engram.ownerId!,
    engramId: engram.id,
    trigger: "autonomous",
    kind: "pdf",
    title,
    prompt,
  });
  logger.info(
    { engramId: engram.id, artifactId: job.id },
    "engram autonomously queued an artifact",
  );
  return job;
}
