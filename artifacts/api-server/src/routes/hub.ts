import { Router } from "express";
import { db } from "@workspace/db";
import { engramsTable } from "@workspace/db/schema";
import type { HubSpace, EngramPresence, HubActivity } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  MoveEngramPresenceParams,
  MoveEngramPresenceBody,
  ListHubActivityQueryParams,
  ListHubSpaceTranscriptParams,
  UpdateHubControlsBody,
} from "@workspace/api-zod";
import {
  loadSpaces,
  loadSpaceById,
  loadPresence,
  loadActivity,
  movePresence,
} from "../lib/hub-store";
import { loadSpaceMessages } from "../lib/messages-store";
import {
  loadControls,
  serializeHubControls,
  updateControls,
} from "../lib/controls-store";
import { publishEvent } from "../lib/events";
import { isArchivalEngram, ARCHIVAL_READ_ONLY_ERROR } from "../lib/archival";

const router = Router();

function serializeSpace(s: HubSpace) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    kind: s.kind,
    description: s.description,
    visibilityScope: s.visibilityScope,
    actionScope: s.actionScope,
    logged: s.logged,
    allowsInitiative: s.allowsInitiative,
    sortOrder: s.sortOrder,
    ambient: s.ambient ?? null,
    accent: s.accent ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

function serializePresence(p: EngramPresence) {
  return {
    id: p.id,
    engramId: p.engramId,
    spaceId: p.spaceId,
    status: p.status,
    note: p.note ?? null,
    enteredAt: p.enteredAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeActivity(a: HubActivity) {
  return {
    id: a.id,
    spaceId: a.spaceId,
    engramId: a.engramId ?? null,
    kind: a.kind,
    summary: a.summary,
    createdAt: a.createdAt.toISOString(),
  };
}

function serializeMessage(m: Awaited<ReturnType<typeof loadSpaceMessages>>[number]) {
  return {
    id: m.id,
    fromEngramId: m.fromEngramId,
    toEngramId: m.toEngramId ?? null,
    spaceId: m.spaceId ?? null,
    channel: m.channel,
    author: m.author,
    priority: m.priority,
    status: m.status,
    content: m.content,
    reason: m.reason ?? null,
    seen: m.seen,
    isDigest: m.isDigest,
    // Commons messages are not human-channel digest rows.
    digestGroupId: null,
    deliveredAt: m.deliveredAt ? m.deliveredAt.toISOString() : null,
    createdAt: m.createdAt.toISOString(),
  };
}

router.get("/hub/spaces", async (req, res) => {
  const spaces = await loadSpaces(req.userId!);
  res.json(spaces.map(serializeSpace));
});

router.get("/hub/presence", async (req, res) => {
  const presence = await loadPresence(req.userId!);
  res.json(presence.map(serializePresence));
});

router.put("/hub/presence/:engramId", async (req, res) => {
  const parsedParams = MoveEngramPresenceParams.safeParse({ engramId: req.params.engramId });
  const parsedBody = MoveEngramPresenceBody.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }

  const [engram] = await db
    .select({ id: engramsTable.id, name: engramsTable.name, isArchival: engramsTable.isArchival })
    .from(engramsTable)
    .where(and(eq(engramsTable.id, parsedParams.data.engramId), eq(engramsTable.ownerId, req.userId!)));
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (engram.isArchival) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }

  const targetSpace = await loadSpaceById(parsedBody.data.spaceId, req.userId!);
  if (!targetSpace) {
    res.status(404).json({ error: "Space not found" });
    return;
  }

  let presence: EngramPresence;
  try {
    presence = await movePresence({
      ownerId: req.userId!,
      engram,
      targetSpace,
      note: parsedBody.data.note ?? null,
    });
  } catch {
    res.status(500).json({ error: "Could not move engram." });
    return;
  }
  const serialized = serializePresence(presence);
  publishEvent({
    type: "presence.changed",
    ownerId: req.userId!,
    engramId: presence.engramId,
    data: { presence: serialized, spaceName: targetSpace.name, engramName: engram.name },
  });
  res.json(serialized);
});

router.get("/hub/activity", async (req, res) => {
  const parsed = ListHubActivityQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (
    parsed.data.spaceId !== undefined &&
    !(await loadSpaceById(parsed.data.spaceId, req.userId!))
  ) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const rows = await loadActivity(req.userId!, {
    spaceId: parsed.data.spaceId,
    limit: parsed.data.limit,
  });
  res.json(rows.map(serializeActivity));
});

router.get("/hub/spaces/:spaceId/transcript", async (req, res) => {
  const parsed = ListHubSpaceTranscriptParams.safeParse({
    spaceId: req.params.spaceId,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const space = await loadSpaceById(parsed.data.spaceId, req.userId!);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const rows = await loadSpaceMessages(req.userId!, space.id, 20);
  res.json(rows.map(serializeMessage));
});

router.get("/hub/controls", async (req, res) => {
  const controls = await loadControls(req.userId!);
  res.json(serializeHubControls(controls));
});

router.put("/hub/controls", async (req, res) => {
  const parsed = UpdateHubControlsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const controls = await updateControls(req.userId!, {
    paused: parsed.data.paused,
    quietMode: parsed.data.quietMode,
  });
  res.json(serializeHubControls(controls));
});

export default router;
