import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";

const h = vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
  return {
    llmCreate: vi.fn(() => {
      throw new Error("archival route reached the language model");
    }),
  };
});


vi.mock("../lib/llm", () => ({
  llm: { chat: { completions: { create: h.llmCreate } } },
  LLM_MODEL: "test-model",
}));

import {
  closeDb,
  conversations,
  db,
  engramArtifactBlobsTable,
  engramArtifactsTable,
  engramInquiriesTable,
  engramPresenceTable,
  engramSimulationStepsTable,
  engramSimulationsTable,
  engramTransmissionsTable,
  engramWorldModelTable,
  engramsTable,
  ensureDatabaseReady,
  hubActivityLogTable,
  hubSpacesTable,
  mediaAssetsTable,
  mediaBlobsTable,
  mediaObservationsTable,
  messages,
} from "@workspace/db";
import { seedFullRezzArchive } from "@workspace/db/seed";
import { asc, eq } from "drizzle-orm";
import { ARCHIVAL_READ_ONLY_ERROR } from "../lib/archival";
import artifactsRouter from "./artifacts";
import engramsRouter from "./engrams";
import worldModelRouter from "./engram-world-model";
import hubRouter from "./hub";
import mediaRouter from "./media";
import openaiRouter from "./openai";
import simulationsRouter from "./simulations";
import { runArtifactTick } from "../services/artifact-worker";

const ready = ensureDatabaseReady({ seed: false });
const FULL_REZZ_SLUG = "rebecca-full-rezz";
const EXPECTED_TRANSCRIPT_LENGTH = 1_534;

interface Fixture {
  engramId: number;
  liveEngramId: number;
  conversationId: number;
  transmissionId: number;
  worldModelEntryId: number;
  mediaAssetId: number;
  artifactId: number;
  targetSpaceId: number;
  simulationId: number;
}

let fixture: Fixture;
let server: Server;
let base: string;

async function resetDatabase(): Promise<void> {
  await db.delete(engramArtifactBlobsTable);
  await db.delete(engramArtifactsTable);
  await db.delete(mediaObservationsTable);
  await db.delete(mediaBlobsTable);
  await db.delete(mediaAssetsTable);
  await db.delete(engramSimulationStepsTable);
  await db.delete(engramSimulationsTable);
  await db.delete(engramWorldModelTable);
  await db.delete(hubActivityLogTable);
  await db.delete(engramPresenceTable);
  await db.delete(engramInquiriesTable);
  await db.delete(engramTransmissionsTable);
  await db.delete(messages);
  await db.delete(conversations);
  await db.delete(engramsTable);
  await db.delete(hubSpacesTable);
}

async function createFixture(): Promise<Fixture> {
  await seedFullRezzArchive(db);
  const [engram] = await db
    .select()
    .from(engramsTable)
    .where(eq(engramsTable.slug, FULL_REZZ_SLUG));
  if (!engram) throw new Error("Full Rezz seed did not create its engram");

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.engramId, engram.id));
  if (!conversation) {
    throw new Error("Full Rezz seed did not create its archival conversation");
  }

  const { id: _archiveId, ...liveEngramValues } = engram;
  const [liveEngram] = await db
    .insert(engramsTable)
    .values({
      ...liveEngramValues,
      slug: "full-rezz-live-test",
      name: "Live test engram",
      title: "Non-archival control",
      origin: "Route-test control row",
      isArchival: false,
      mode: "orientation",
      currentMood: null,
    })
    .returning();

  const [transmission] = await db
    .insert(engramTransmissionsTable)
    .values({
      engramId: engram.id,
      kind: "outreach",
      drive: "continuity",
      content: "preserved transmission",
      importanceScore: 1,
      confidenceScore: 1,
      noveltyScore: 1,
      overallScore: 1,
      seen: false,
    })
    .returning();

  await db.insert(engramInquiriesTable).values({
    engramId: engram.id,
    kind: "probe",
    question: "preserved question",
    response: "preserved response",
    configDelta: null,
  });

  const [worldModelEntry] = await db
    .insert(engramWorldModelTable)
    .values({
      engramId: engram.id,
      provenance: "remembered",
      content: "preserved memory",
      confidence: 1,
      scope: "private",
      source: "archive",
    })
    .returning();

  const [mediaAsset] = await db
    .insert(mediaAssetsTable)
    .values({
      engramId: engram.id,
      conversationId: conversation.id,
      filename: "preserved.txt",
      mimeType: "text/plain",
      modality: "text",
      sizeBytes: 9,
      status: "failed",
      error: "preserved failure",
    })
    .returning();
  await db.insert(mediaBlobsTable).values({
    assetId: mediaAsset.id,
    data: Buffer.from("preserved"),
  });
  await db.insert(mediaObservationsTable).values({
    assetId: mediaAsset.id,
    worldModelEntryId: worldModelEntry.id,
  });

  const [artifact] = await db
    .insert(engramArtifactsTable)
    .values({
      engramId: engram.id,
      conversationId: conversation.id,
      trigger: "operator",
      kind: "pdf",
      title: "preserved artifact",
      prompt: "preserved generation prompt",
      status: "failed",
      error: "preserved failure",
    })
    .returning();
  await db.insert(engramArtifactBlobsTable).values({
    artifactId: artifact.id,
    data: Buffer.from("preserved artifact bytes"),
  });

  const [archiveSpace, targetSpace, chamberSpace] = await db
    .insert(hubSpacesTable)
    .values([
      {
        slug: "full-rezz-archive-test",
        name: "Archive",
        kind: "archive",
        description: "Preserved",
        visibilityScope: "operators",
        actionScope: "rest",
        sortOrder: 1,
      },
      {
        slug: "full-rezz-target-test",
        name: "Commons",
        kind: "commons",
        description: "Movement target",
        visibilityScope: "public",
        actionScope: "converse",
        sortOrder: 2,
      },
      {
        slug: "full-rezz-chamber-test",
        name: "Simulation Chamber",
        kind: "simulation_chamber",
        description: "Historical fixture",
        visibilityScope: "operators",
        actionScope: "simulate",
        sortOrder: 3,
      },
    ])
    .returning();

  await db.insert(engramPresenceTable).values({
    engramId: engram.id,
    spaceId: archiveSpace.id,
    status: "resting",
    note: "preserved in place",
  });
  await db.insert(hubActivityLogTable).values({
    engramId: engram.id,
    spaceId: archiveSpace.id,
    kind: "enter",
    summary: "preserved placement",
  });

  const [simulation] = await db
    .insert(engramSimulationsTable)
    .values({
      engramId: engram.id,
      spaceId: chamberSpace.id,
      premise: "preserved historical simulation",
      status: "paused",
      currentStep: 1,
      maxSteps: 5,
      pausedAt: new Date("2026-08-03T00:30:00.000Z"),
    })
    .returning();
  await db.insert(engramSimulationStepsTable).values({
    simulationId: simulation.id,
    stepNumber: 1,
    narrative: "preserved historical step",
    worldModelEntryId: worldModelEntry.id,
  });

  return {
    engramId: engram.id,
    liveEngramId: liveEngram.id,
    conversationId: conversation.id,
    transmissionId: transmission.id,
    worldModelEntryId: worldModelEntry.id,
    mediaAssetId: mediaAsset.id,
    artifactId: artifact.id,
    targetSpaceId: targetSpace.id,
    simulationId: simulation.id,
  };
}

async function snapshotArchiveState() {
  const [
    engrams,
    conversationRows,
    messageRows,
    transmissions,
    inquiries,
    worldModel,
    mediaAssets,
    mediaBlobs,
    mediaObservations,
    artifacts,
    artifactBlobs,
    spaces,
    presence,
    activity,
    simulations,
    simulationSteps,
  ] = await Promise.all([
    db.select().from(engramsTable).orderBy(asc(engramsTable.id)),
    db.select().from(conversations).orderBy(asc(conversations.id)),
    db.select().from(messages).orderBy(asc(messages.id)),
    db
      .select()
      .from(engramTransmissionsTable)
      .orderBy(asc(engramTransmissionsTable.id)),
    db
      .select()
      .from(engramInquiriesTable)
      .orderBy(asc(engramInquiriesTable.id)),
    db
      .select()
      .from(engramWorldModelTable)
      .orderBy(asc(engramWorldModelTable.id)),
    db.select().from(mediaAssetsTable).orderBy(asc(mediaAssetsTable.id)),
    db.select().from(mediaBlobsTable).orderBy(asc(mediaBlobsTable.assetId)),
    db
      .select()
      .from(mediaObservationsTable)
      .orderBy(asc(mediaObservationsTable.id)),
    db
      .select()
      .from(engramArtifactsTable)
      .orderBy(asc(engramArtifactsTable.id)),
    db
      .select()
      .from(engramArtifactBlobsTable)
      .orderBy(asc(engramArtifactBlobsTable.artifactId)),
    db.select().from(hubSpacesTable).orderBy(asc(hubSpacesTable.id)),
    db.select().from(engramPresenceTable).orderBy(asc(engramPresenceTable.id)),
    db.select().from(hubActivityLogTable).orderBy(asc(hubActivityLogTable.id)),
    db
      .select()
      .from(engramSimulationsTable)
      .orderBy(asc(engramSimulationsTable.id)),
    db
      .select()
      .from(engramSimulationStepsTable)
      .orderBy(asc(engramSimulationStepsTable.id)),
  ]);
  return {
    engrams,
    conversations: conversationRows,
    messages: messageRows,
    transmissions,
    inquiries,
    worldModel,
    mediaAssets,
    mediaBlobs,
    mediaObservations,
    artifacts,
    artifactBlobs,
    spaces,
    presence,
    activity,
    simulations,
    simulationSteps,
  };
}

function jsonRequest(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function multipartRequest(
  path: string,
  fields: Record<string, string> = {},
): Promise<Response> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    form.append(name, value);
  }
  form.append(
    "file",
    new Blob(["attempted mutation"], { type: "text/plain" }),
    "attempt.txt",
  );
  return fetch(`${base}${path}`, { method: "POST", body: form });
}

beforeAll(async () => {
  await ready;
  await resetDatabase();
  fixture = await createFixture();

  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: ExpressResponse, next: NextFunction) => {
    (req as Request & { log: unknown }).log = {
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Request["log"];
    next();
  });
  app.use("/api", engramsRouter);
  app.use("/api", openaiRouter);
  app.use("/api", mediaRouter);
  app.use("/api", artifactsRouter);
  app.use("/api", worldModelRouter);
  app.use("/api", hubRouter);
  app.use("/api", simulationsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
});

describe.sequential("Full Rezz archival route guards", () => {
  const attempts: Array<{
    name: string;
    request: () => Promise<Response>;
  }> = [
    {
      name: "engram config update",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}`, "PATCH", {
          autonomyEnabled: true,
        }),
    },
    {
      name: "engram activation",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}/activate`, "POST"),
    },
    {
      name: "forced transmission",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}/transmit`, "POST"),
    },
    {
      name: "transmission seen-state update",
      request: () =>
        jsonRequest(
          `/api/engrams/${fixture.engramId}/transmissions/mark-seen`,
          "POST",
          { ids: [fixture.transmissionId] },
        ),
    },
    {
      name: "probe inquiry",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}/inquiries`, "POST", {
          kind: "probe",
          question: "Can this append a log row?",
        }),
    },
    {
      name: "develop inquiry",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}/inquiries`, "POST", {
          kind: "develop",
          question: "Can this tune the archive?",
        }),
    },
    {
      name: "conversation creation",
      request: () =>
        jsonRequest("/api/openai/conversations", "POST", {
          title: "Attempted branch",
          mode: "companion",
          engramId: fixture.engramId,
        }),
    },
    {
      name: "conversation deletion",
      request: () =>
        jsonRequest(
          `/api/openai/conversations/${fixture.conversationId}`,
          "DELETE",
        ),
    },
    {
      name: "chat message append",
      request: () =>
        jsonRequest(
          `/api/openai/conversations/${fixture.conversationId}/messages`,
          "POST",
          { content: "Attempted appended turn" },
        ),
    },
    {
      name: "conversation media upload",
      request: () =>
        multipartRequest(
          `/api/openai/conversations/${fixture.conversationId}/media`,
        ),
    },
    {
      name: "media upload",
      request: () =>
        multipartRequest("/api/media", {
          engramId: String(fixture.engramId),
        }),
    },
    {
      name: "media retry",
      request: () =>
        jsonRequest(`/api/media/${fixture.mediaAssetId}/retry`, "POST"),
    },
    {
      name: "media deletion",
      request: () =>
        jsonRequest(`/api/media/${fixture.mediaAssetId}`, "DELETE"),
    },
    {
      name: "artifact creation",
      request: () =>
        jsonRequest("/api/artifacts", "POST", {
          engramId: fixture.engramId,
          conversationId: fixture.conversationId,
          kind: "pdf",
          title: "attempted artifact",
          prompt: "attempted generation",
        }),
    },
    {
      name: "artifact creation with a live engram but archival conversation",
      request: () =>
        jsonRequest("/api/artifacts", "POST", {
          engramId: fixture.liveEngramId,
          conversationId: fixture.conversationId,
          kind: "pdf",
          title: "attempted mixed-reference artifact",
          prompt: "attempted mixed-reference generation",
        }),
    },
    {
      name: "artifact retry",
      request: () =>
        jsonRequest(`/api/artifacts/${fixture.artifactId}/retry`, "POST"),
    },
    {
      name: "artifact deletion",
      request: () =>
        jsonRequest(`/api/artifacts/${fixture.artifactId}`, "DELETE"),
    },
    {
      name: "world-model creation",
      request: () =>
        jsonRequest(`/api/engrams/${fixture.engramId}/world-model`, "POST", {
          provenance: "observed",
          content: "attempted memory",
          confidence: 0.8,
          scope: "private",
        }),
    },
    {
      name: "world-model update",
      request: () =>
        jsonRequest(
          `/api/engrams/${fixture.engramId}/world-model/${fixture.worldModelEntryId}`,
          "PATCH",
          { content: "attempted rewrite" },
        ),
    },
    {
      name: "world-model deletion",
      request: () =>
        jsonRequest(
          `/api/engrams/${fixture.engramId}/world-model/${fixture.worldModelEntryId}`,
          "DELETE",
        ),
    },
    {
      name: "Hub movement",
      request: () =>
        jsonRequest(`/api/hub/presence/${fixture.engramId}`, "PUT", {
          spaceId: fixture.targetSpaceId,
          note: "attempted move",
        }),
    },
    {
      name: "simulation creation",
      request: () =>
        jsonRequest("/api/simulations", "POST", {
          engramId: fixture.engramId,
          premise: "attempted scenario",
          maxSteps: 2,
        }),
    },
    {
      name: "simulation control",
      request: () =>
        jsonRequest(
          `/api/simulations/${fixture.simulationId}/control`,
          "POST",
          { action: "resume" },
        ),
    },
  ];

  it.each(attempts)(
    "rejects $name with 403 and changes no archival-linked rows",
    async ({ request }) => {
      const before = await snapshotArchiveState();
      expect(before.messages).toHaveLength(EXPECTED_TRANSCRIPT_LENGTH);

      const response = await request();

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: ARCHIVAL_READ_ONLY_ERROR,
      });
      expect(await snapshotArchiveState()).toEqual(before);
      expect(h.llmCreate).not.toHaveBeenCalled();
    },
  );

  it("leaves pending and stale-processing archival artifact jobs untouched", async () => {
    const old = new Date("2020-01-01T00:00:00.000Z");
    const archivalJobs = await db
      .insert(engramArtifactsTable)
      .values([
        {
          engramId: fixture.engramId,
          trigger: "operator",
          kind: "pdf",
          title: "direct pending archive",
          prompt: "must never run",
          status: "pending",
        },
        {
          engramId: fixture.liveEngramId,
          conversationId: fixture.conversationId,
          trigger: "operator",
          kind: "pdf",
          title: "mixed pending archive",
          prompt: "must never run",
          status: "pending",
        },
        {
          engramId: fixture.engramId,
          trigger: "operator",
          kind: "pdf",
          title: "direct stale archive",
          prompt: "must never recover",
          status: "processing",
          startedAt: old,
        },
        {
          engramId: fixture.liveEngramId,
          conversationId: fixture.conversationId,
          trigger: "operator",
          kind: "pdf",
          title: "mixed stale archive",
          prompt: "must never recover",
          status: "processing",
          startedAt: old,
        },
      ])
      .returning();
    await db.insert(engramArtifactBlobsTable).values(
      archivalJobs.map((artifact) => ({
        artifactId: artifact.id,
        data: Buffer.from(`preserved-${artifact.id}`),
      })),
    );
    const before = await snapshotArchiveState();

    await expect(runArtifactTick()).resolves.toEqual({ processed: 0 });

    expect(await snapshotArchiveState()).toEqual(before);
    expect(h.llmCreate).not.toHaveBeenCalled();
  });
});