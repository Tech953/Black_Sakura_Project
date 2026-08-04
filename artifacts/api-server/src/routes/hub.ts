import { Router } from "express";
import { db } from "@workspace/db";
import { engramsTable } from "@workspace/db/schema";
import type { HubSpace, EngramPresence, HubActivity } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  MoveEngramPresenceParams,
  MoveEngramPresenceBody,
  ListHubActivityQueryParams,
  UpdateHubControlsBody,
} from "@workspace/api-zod";
import type { HubControls } from "@workspace/db";
import {
  loadSpaces,
  loadSpaceById,
  loadPresence,
  loadActivity,
  movePresence,
} from "../lib/hub-store";
import { loadControls, updateControls } from "../lib/controls-store";
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

function serializeControls(c: HubControls) {
  return {
    id: c.id,
    paused: c.paused,
    quietMode: c.quietMode,
    updatedAt: c.updatedAt.toISOString(),
  };
}

router.get("/hub/spaces", async (_req, res) => {
  const spaces = await loadSpaces();
  res.json(spaces.map(serializeSpace));
});

router.get("/hub/presence", async (_req, res) => {
  const presence = await loadPresence();
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
    .select({ id: engramsTable.id, name: engramsTable.name })
    .from(engramsTable)
    .where(eq(engramsTable.id, parsedParams.data.engramId));
  if (!engram) {
    res.status(404).json({ error: "Engram not found" });
    return;
  }
  if (await isArchivalEngram(engram.id)) {
    res.status(403).json({ error: ARCHIVAL_READ_ONLY_ERROR });
    return;
  }

  const targetSpace = await loadSpaceById(parsedBody.data.spaceId);
  if (!targetSpace) {
    res.status(404).json({ error: "Space not found" });
    return;
  }

  const presence = await movePresence({
    engram,
    targetSpace,
    note: parsedBody.data.note ?? null,
  });
  const serialized = serializePresence(presence);
  publishEvent({
    type: "presence.changed",
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
  const rows = await loadActivity({
    spaceId: parsed.data.spaceId,
    limit: parsed.data.limit,
  });
  res.json(rows.map(serializeActivity));
});

router.get("/hub/controls", async (_req, res) => {
  const controls = await loadControls();
  res.json(serializeControls(controls));
});

router.put("/hub/controls", async (req, res) => {
  const parsed = UpdateHubControlsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const controls = await updateControls({
    paused: parsed.data.paused,
    quietMode: parsed.data.quietMode,
  });
  res.json(serializeControls(controls));
});

export default router;
