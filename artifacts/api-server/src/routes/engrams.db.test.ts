import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const generationMocks = vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;

  return {
    generateProbeResponse: vi.fn(async (_options: unknown) => "I am as I was."),
    generateDevelopment: vi.fn(async (_options: unknown) => ({
      response: "I shift toward you.",
      delta: {
        focusThemes: ["closer"],
        addFacts: ["A durable change."],
      },
    })),
  };
});

vi.mock("../lib/engram-generation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/engram-generation")>();
  return {
    ...actual,
    generateProbeResponse: generationMocks.generateProbeResponse,
    generateDevelopment: generationMocks.generateDevelopment,
  };
});

import {
  closeDb,
  db,
  engramInquiriesTable,
  engramsTable,
  ensureDatabaseReady,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import engramsRouter from "./engrams";

const OWNER_ID = "engram-inquiry-db-test-owner";
const ready = ensureDatabaseReady({ seed: false });
const routeErrors: unknown[] = [];

let server: Server;
let base: string;
let engramSequence = 0;

beforeAll(async () => {
  await ready;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as typeof req & { userId: string }).userId = OWNER_ID;
    (req as unknown as { log: { error: (error: unknown) => void } }).log = {
      error: (error) => routeErrors.push(error),
    };
    next();
  });
  app.use("/api", engramsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  await closeDb();
});

beforeEach(async () => {
  await ready;
  await db.delete(engramInquiriesTable);
  await db.delete(engramsTable);
  routeErrors.length = 0;
  generationMocks.generateProbeResponse.mockClear();
  generationMocks.generateDevelopment.mockClear();
});

async function insertEngram(): Promise<number> {
  engramSequence += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: OWNER_ID,
      slug: `inquiry-db-${engramSequence}`,
      name: "Inquiry DB Test Engram",
      title: "Inquiry transaction test",
      symbol: "I",
      origin: "DB route test",
      voiceProfile: {
        speechStyle: "plain",
        formatting: "plain",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "first-person",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "steady" },
      environmentAnchor: {
        name: "Test Hub",
        description: "A database route fixture",
        locations: [],
        items: [],
        ambient: "quiet",
      },
      memorySeed: {
        relationship: "test",
        facts: ["Existing fact"],
        summary: "Baseline memory",
      },
      guardrails: { framing: "test", boundaries: [] },
      drives: [],
      focusThemes: ["existing"],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

function inquiryUrl(engramId: number): string {
  return `${base}/api/engrams/${engramId}/inquiries`;
}

function errorChainText(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current = error;

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const details = current as {
      name?: unknown;
      message?: unknown;
      code?: unknown;
      constraint?: unknown;
      cause?: unknown;
      err?: unknown;
    };
    parts.push(
      [details.name, details.message, details.code, details.constraint]
        .filter((part) => part !== undefined)
        .map(String)
        .join(" "),
    );
    current = details.cause ?? details.err;
  }

  return parts.join("\n");
}

describe("POST /engrams/:id/inquiries with a real PGlite database", () => {
  it("probe stores only an inquiry and never opens a configuration transaction", async () => {
    const engramId = await insertEngram();
    const [before] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.id, engramId));
    const transactionSpy = vi.spyOn(db, "transaction");

    try {
      const response = await fetch(inquiryUrl(engramId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "probe", question: "Who are you?" }),
      });
      expect(response.status).toBe(201);
      const body = (await response.json()) as {
        id: number;
        engramId: number;
        kind: string;
        question: string;
        response: string;
        configDelta: unknown;
      };
      expect(body).toMatchObject({
        engramId,
        kind: "probe",
        question: "Who are you?",
        response: "I am as I was.",
        configDelta: null,
      });
      expect(generationMocks.generateProbeResponse).toHaveBeenCalledTimes(1);
      expect(transactionSpy).not.toHaveBeenCalled();
    } finally {
      transactionSpy.mockRestore();
    }

    const [after] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.id, engramId));
    const inquiries = await db
      .select()
      .from(engramInquiriesTable)
      .where(eq(engramInquiriesTable.engramId, engramId));

    expect(after).toEqual(before);
    expect(inquiries).toHaveLength(1);
    expect(inquiries[0]).toMatchObject({
      id: expect.any(Number),
      engramId,
      kind: "probe",
      question: "Who are you?",
      response: "I am as I was.",
      configDelta: null,
    });
  });

  it("rolls back a valid develop update when PostgreSQL rejects the inquiry insert", async () => {
    const engramId = await insertEngram();
    const failingQuestion = "force inquiry insert constraint failure";
    const [existingInquiry] = await db
      .insert(engramInquiriesTable)
      .values({
        engramId,
        kind: "probe",
        question: "Previously stored inquiry",
        response: "This row must remain unchanged.",
        configDelta: null,
      })
      .returning();
    const [beforeEngram] = await db
      .select()
      .from(engramsTable)
      .where(eq(engramsTable.id, engramId));
    const inquiriesBefore = await db.select().from(engramInquiriesTable);
    expect(existingInquiry).toBeDefined();

    const constraintName = "engram_inquiry_route_test_reject_question";
    await db.execute(
      sql.raw(
        `ALTER TABLE "engram_inquiries" ADD CONSTRAINT "${constraintName}" CHECK ("question" <> '${failingQuestion}')`,
      ),
    );

    try {
      const response = await fetch(inquiryUrl(engramId), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "develop", question: failingQuestion }),
      });

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: "Inquiry result could not be saved",
        code: "INQUIRY_PERSISTENCE_FAILED",
        message:
          "The generated inquiry result could not be saved. No configuration changes were applied.",
      });
      expect(generationMocks.generateDevelopment).toHaveBeenCalledTimes(1);
      expect(generationMocks.generateDevelopment).toHaveBeenCalledWith(
        expect.objectContaining({ question: failingQuestion }),
      );
      expect(routeErrors).toHaveLength(1);
      expect(errorChainText(routeErrors[0])).toContain(constraintName);

      const [afterEngram] = await db
        .select()
        .from(engramsTable)
        .where(eq(engramsTable.id, engramId));
      const inquiriesAfter = await db.select().from(engramInquiriesTable);
      expect(afterEngram).toEqual(beforeEngram);
      expect(inquiriesAfter).toEqual(inquiriesBefore);
      expect(inquiriesAfter.some((inquiry) => inquiry.question === failingQuestion)).toBe(false);
    } finally {
      await db.execute(
        sql.raw(`ALTER TABLE "engram_inquiries" DROP CONSTRAINT "${constraintName}"`),
      );
    }
  });
});