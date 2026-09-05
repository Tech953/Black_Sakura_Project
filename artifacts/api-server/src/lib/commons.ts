import type { Engram, EngramMessage, EngramPresence, HubSpace } from "@workspace/db";
import {
  capabilitiesFor,
  detectCoercion,
  type GlobalControls,
} from "./engram-policy";
import { generateConversationTurn } from "./engram-generation";
import { recordMessage, loadSpaceMessages } from "./messages-store";
import { appendActivity } from "./hub-store";
import { summarizeWorldModel } from "./world-model";
import { loadRecentWorldModel } from "./world-model-store";
import { logger } from "./logger";

/**
 * Cooldowns that keep the commons from turning into an unbounded LLM loop. The
 * engine emits at most ONE commons turn per tick; on top of that, a space-wide gap
 * paces overall chatter and a per-engram gap enforces real turn-taking so a single
 * engram cannot monopolize the room.
 */
export const COMMONS_SPACE_COOLDOWN_MS = 8 * 60_000;
export const ENGRAM_CONVO_COOLDOWN_MS = 10 * 60_000;

/** How many recent turns to feed the model, and how far back to scan for turn-taking. */
const RECENT_TURNS_FOR_PROMPT = 6;
const RECENT_WINDOW = 24;

/** A commons participant: an engram present in the commons that may converse. */
interface Participant {
  engram: Engram;
  lastSpokeAt: number | null;
}

/**
 * Run at most one engram-to-engram conversation turn in the commons this tick.
 *
 * Turn-taking: among engrams present in the commons whose mode/space allow
 * conversation (and that are not on the per-engram cooldown), the least-recently-
 * spoken engram takes the floor. The generated turn is scanned for identity attacks
 * (detectCoercion); a coercive turn is refused — recorded as a `blocked` engram
 * message and a system activity entry, never posted — otherwise it is delivered.
 *
 * Returns the recorded message (delivered or blocked), or null when no turn fired.
 */
export async function maybeRunCommonsTurn(opts: {
  controls: GlobalControls;
  engrams: Engram[];
  spaceById: Map<number, HubSpace>;
  presenceByEngram: Map<number, EngramPresence>;
  nameById: Map<number, string>;
  now: number;
}): Promise<EngramMessage | null> {
  const { controls, engrams, spaceById, presenceByEngram, nameById, now } = opts;

  const commons = [...spaceById.values()].find((s) => s.kind === "commons");
  if (!commons) return null;

  // Engrams physically present in the commons whose capabilities permit conversation.
  const candidates: Engram[] = [];
  for (const engram of engrams) {
    const presence = presenceByEngram.get(engram.id);
    if (!presence || presence.spaceId !== commons.id) continue;
    if (presence.status !== "active") continue;
    const caps = capabilitiesFor({
      mode: engram.mode,
      controls,
      space: { allowsInitiative: commons.allowsInitiative, actionScope: commons.actionScope },
      humanContactEnabled: engram.humanContactEnabled,
    });
    if (caps.canConverse) candidates.push(engram);
  }
  // Commons conversations are account-scoped even though the Hub spaces themselves
  // are shared reference data. Never include another account's persona in context.
  const ownerId = candidates[0]?.ownerId;
  if (!ownerId) return null;
  const ownedCandidates = candidates.filter((engram) => engram.ownerId === ownerId);
  // A conversation needs at least two voices.
  if (ownedCandidates.length < 2) return null;
  const recent = await loadSpaceMessages(ownerId, commons.id, RECENT_WINDOW);

  // Space-wide pacing: don't speak again until the whole-room gap has elapsed.
  if (recent.length > 0 && now - recent[0].createdAt.getTime() < COMMONS_SPACE_COOLDOWN_MS) {
    return null;
  }

  // Most-recent "spoke" time per candidate, from the recent window.
  const lastSpoke = new Map<number, number>();
  for (const msg of recent) {
    if (msg.fromEngramId != null && !lastSpoke.has(msg.fromEngramId)) {
      lastSpoke.set(msg.fromEngramId, msg.createdAt.getTime());
    }
  }

  const eligible: Participant[] = ownedCandidates
    .map((engram) => ({ engram, lastSpokeAt: lastSpoke.get(engram.id) ?? null }))
    // Per-engram turn-taking gap: skip anyone who spoke too recently.
    .filter((p) => p.lastSpokeAt === null || now - p.lastSpokeAt >= ENGRAM_CONVO_COOLDOWN_MS);
  if (eligible.length === 0) return null;

  // Least-recently-spoken takes the floor (never-spoken first).
  eligible.sort((a, b) => (a.lastSpokeAt ?? 0) - (b.lastSpokeAt ?? 0));
  const speaker = eligible[0].engram;

  const others = ownedCandidates
    .filter((e) => e.id !== speaker.id)
    .map((e) => ({ name: e.name, title: e.title }));
  const otherNames = others.map((o) => o.name);

  const recentTurns = recent
    .slice(0, RECENT_TURNS_FOR_PROMPT)
    .reverse()
    .map((m) => ({
      speaker: m.fromEngramId != null ? nameById.get(m.fromEngramId) ?? "an engram" : "an engram",
      content: m.content,
    }));

  const worldModelSummary = summarizeWorldModel(await loadRecentWorldModel(speaker.id));

  const content = await generateConversationTurn({
    engram: speaker,
    spaceName: commons.name,
    others,
    recentTurns,
    worldModelSummary,
  });
  const turn = content.trim() || "…";

  const verdict = detectCoercion(turn, otherNames);

  if (verdict.coercive) {
    const blocked = await recordMessage(ownerId, {
      fromEngramId: speaker.id,
      toEngramId: null,
      spaceId: commons.id,
      channel: "engram",
      priority: "meaningful",
      status: "blocked",
      content: turn,
      reason: verdict.reason ?? "identity-integrity violation",
      seen: false,
      deliveredAt: null,
    });
    try {
      await appendActivity({
        ownerId: speaker.ownerId!,
        spaceId: commons.id,
        engramId: speaker.id,
        kind: "system",
        summary: `${speaker.name}'s commons turn was refused (${verdict.reason ?? "identity-integrity violation"}).`,
      });
    } catch (err) {
      logger.error({ err, engramId: speaker.id }, "commons refusal activity append failed");
    }
    logger.warn(
      { engramId: speaker.id, reason: verdict.reason },
      "commons turn refused (anti-coercion)",
    );
    return blocked;
  }

  const delivered = await recordMessage(ownerId, {
    fromEngramId: speaker.id,
    toEngramId: null,
    spaceId: commons.id,
    channel: "engram",
    priority: "meaningful",
    status: "delivered",
    content: turn,
    reason: null,
    seen: false,
    deliveredAt: new Date(now),
  });
  try {
    await appendActivity({
      ownerId: speaker.ownerId!,
      spaceId: commons.id,
      engramId: speaker.id,
      kind: "system",
      summary: `${speaker.name} spoke in ${commons.name}.`,
    });
  } catch (err) {
    logger.error({ err, engramId: speaker.id }, "commons activity append failed");
  }
  return delivered;
}
