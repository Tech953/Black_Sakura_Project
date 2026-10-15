import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// The DB driver is selected while @workspace/db is imported.
vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
});

import {
  beliefsTable,
  closeDb,
  db,
  ensureDatabaseReady,
  evolutionTable,
  expressionsTable,
  hieroTable,
  initiativeTable,
  journalTable,
  personasTable,
} from "@workspace/db";
import journalRouter from "./journal";
import personasRouter from "./personas";
import evolutionRouter from "./evolution";
import beliefsRouter from "./beliefs";
import initiativeRouter from "./initiative";
import hieroRouter from "./hiero";
import expressionsRouter from "./expressions";

const ready = ensureDatabaseReady({ seed: false });
let server: Server;
let base: string;

function requestAs(ownerId: string, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("x-test-user-id", ownerId);
  return fetch(`${base}${path}`, {
    ...init,
    headers,
  });
}

beforeAll(async () => {
  await ready;
  const app = express();
  app.use(express.json());
  // The production router receives this exclusively from requireAuth. This test
  // seam deliberately models that authenticated value rather than accepting it
  // in a request body.
  app.use((req, _res, next) => {
    req.userId = req.header("x-test-user-id")!;
    next();
  });
  app.use(journalRouter);
  app.use(personasRouter);
  app.use(evolutionRouter);
  app.use(beliefsRouter);
  app.use(initiativeRouter);
  app.use(hieroRouter);
  app.use(expressionsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await closeDb();
});

beforeEach(async () => {
  await ready;
  await db.delete(beliefsTable);
  await db.delete(initiativeTable);
  await db.delete(evolutionTable);
  await db.delete(journalTable);
  await db.delete(personasTable);
  await db.delete(hieroTable);
  await db.delete(expressionsTable);
});

describe("legacy root ownership", () => {
  it("sets journal and initiative owners on the server and lists only the caller's rows", async () => {
    const journalBody = {
      event: "operator note",
      confidence: 0.8,
      reflection: "private",
      actionItems: "none",
    };
    expect(
      (await requestAs("owner-a", "/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...journalBody, ownerId: "owner-b" }),
      })).status,
    ).toBe(201);
    expect(
      (await requestAs("owner-a", "/initiative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trigger: "test",
          message: "private",
          importanceScore: 0.8,
          confidenceScore: 0.7,
          noveltyScore: 0.6,
          overallScore: 0.7,
          wasDelivered: false,
          ownerId: "owner-b",
        }),
      })).status,
    ).toBe(201);

    expect(await (await requestAs("owner-b", "/journal")).json()).toEqual([]);
    expect(await (await requestAs("owner-b", "/initiative")).json()).toEqual([]);
    expect((await db.select().from(journalTable))[0].ownerId).toBe("owner-a");
    expect((await db.select().from(initiativeTable))[0].ownerId).toBe("owner-a");
  });

  it("does not reveal or modify another owner's persona, evolution, beliefs, symbols, or expressions", async () => {
    const [persona] = await db.insert(personasTable).values({
      ownerId: "owner-a",
      name: "Owner A",
      description: "private",
      emphasis: "private",
      symbol: "A",
      memoryBias: "private",
      reasoningStyle: "private",
    }).returning();
    await db.insert(evolutionTable).values({
      ownerId: "owner-a",
      revision: 1,
      trigger: "private",
      description: "private",
      confidence: 1,
    });
    const [belief] = await db.insert(beliefsTable).values({
      ownerId: "owner-a",
      statement: "private",
      confidence: 1,
      evidence: "private",
      lastReviewed: "2026-01-01",
    }).returning();
    await db.insert(hieroTable).values({
      ownerId: "owner-a",
      glyph: "𓀀",
      name: "private",
      meaning: "private",
      category: "private",
    });
    await db.insert(expressionsTable).values({
      ownerId: "owner-a",
      glyph: "ಠ_ಠ",
      name: "private",
      family: "private",
      eyes: "private",
      mouth: "private",
      valence: "private",
      arousal: "private",
      notes: "private",
    });

    for (const path of ["/personas", "/evolution", "/hiero-code", "/expressions"]) {
      expect(await (await requestAs("owner-b", path)).json()).toEqual([]);
    }
    expect(
      (await requestAs("owner-b", "/personas/active", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: persona.id }),
      })).status,
    ).toBe(404);
    expect(
      (await requestAs("owner-b", `/beliefs/${belief.id}`, { method: "DELETE" })).status,
    ).toBe(404);

    const [storedPersona] = await db.select().from(personasTable);
    expect(storedPersona.isActive).toBe(false);
    expect((await db.select().from(beliefsTable)).map((row) => row.id)).toContain(belief.id);
  });
});