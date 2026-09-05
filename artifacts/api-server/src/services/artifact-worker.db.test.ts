import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// Run against a REAL embedded Postgres (in-memory PGlite) so the actual queue
// SQL/locking is exercised, and mock only the LLM seam so authoring is
// deterministic. The driver seam reads ENGRAM_DB_DRIVER at import time, so it
// must be set before the module graph loads — vi.hoisted runs ahead of imports.
const h = vi.hoisted(() => {
  process.env.ENGRAM_DB_DRIVER = "pglite";
  delete process.env.PGLITE_DATA_DIR;
  class GenerationUnavailableError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "GenerationUnavailableError";
    }
  }
  const create = vi.fn(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            title: "On Quiet Systems",
            summary: "A short reflection authored in-voice.",
            sections: [
              { heading: "Opening", body: "The lattice hums. I listen to it." },
              { heading: "Closing", body: "I set this down as a record." },
            ],
          }),
        },
      },
    ],
  }));
  const unavailable = async () => {
    throw new GenerationUnavailableError(
      "No online generation provider is configured.",
    );
  };
  return {
    create,
    llm: { chat: { completions: { create } } },
    generateImage: vi.fn(unavailable),
    generateVideo: vi.fn(unavailable),
    GenerationUnavailableError,
  };
});

vi.mock("../lib/llm", () => ({ llm: h.llm, LLM_MODEL: "test-model" }));
vi.mock("../lib/generation-client", () => ({
  generateImage: h.generateImage,
  generateVideo: h.generateVideo,
  GenerationUnavailableError: h.GenerationUnavailableError,
}));

import {
  db,
  ensureDatabaseReady,
  closeDb,
  engramsTable,
  engramArtifactsTable,
  engramArtifactBlobsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import {
  createArtifactJob,
  loadArtifactById,
  loadArtifactBlob,
  requeueArtifact,
  deleteArtifact,
} from "../lib/artifact-store";
import { runArtifactTick } from "./artifact-worker";

const ready = ensureDatabaseReady({ seed: false });
const TEST_OWNER_ID = "test_artifact_worker_owner";

beforeEach(async () => {
  await ready;
  await db.execute(sql`ALTER TABLE engram_artifacts ADD COLUMN IF NOT EXISTS owner_id text NOT NULL DEFAULT '__engram_system_template__'`);
  h.create.mockClear();
  h.generateImage.mockClear();
  h.generateVideo.mockClear();
  await db.delete(engramArtifactBlobsTable);
  await db.delete(engramArtifactsTable);
  await db.delete(engramsTable);
});

afterAll(async () => {
  await closeDb();
});

let seq = 0;
async function insertEngram(): Promise<number> {
  seq += 1;
  const [row] = await db
    .insert(engramsTable)
    .values({
      ownerId: TEST_OWNER_ID,
      slug: `studio-engram-${seq}`,
      name: `Studio Engram ${seq}`,
      title: "Author",
      symbol: "A",
      origin: "test",
      voiceProfile: {
        speechStyle: "",
        formatting: "",
        vocabulary: [],
        sampleLines: [],
        narrationStyle: "",
      },
      emotionalBaseline: { valence: 0, arousal: 0, volatility: 0, mood: "" },
      environmentAnchor: {
        name: "",
        description: "",
        locations: [],
        items: [],
        ambient: "",
      },
      memorySeed: { relationship: "", facts: [], summary: "" },
      guardrails: { framing: "", boundaries: [] },
      drives: [],
      focusThemes: [],
    })
    .returning({ id: engramsTable.id });
  return row.id;
}

describe("artifact worker — local PDF generation end-to-end", () => {
  it("queues a PDF job, the worker completes it, and the bytes are a real PDF", async () => {
    const engramId = await insertEngram();
    const job = await createArtifactJob({
      ownerId: TEST_OWNER_ID,
      engramId,
      trigger: "operator",
      kind: "pdf",
      title: "Field Notes",
      prompt: "Reflect on the quiet of the lattice.",
    });
    expect(job.status).toBe("pending");

    const { processed } = await runArtifactTick();
    expect(processed).toBe(1);

    const done = await loadArtifactById(job.id);
    expect(done?.status).toBe("completed");
    expect(done?.provider).toBe("local-pdf-lib");
    expect(done?.mimeType).toBe("application/pdf");
    expect(done?.summary).toBe("A short reflection authored in-voice.");
    expect((done?.sizeBytes ?? 0)).toBeGreaterThan(0);

    const blob = await loadArtifactBlob(job.id);
    expect(blob).toBeDefined();
    // Real PDF magic header.
    expect(blob!.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(blob!.data.length).toBe(done?.sizeBytes);
    expect(blob!.filename.endsWith(".pdf")).toBe(true);
  });

  it("falls back to a prose section (still a valid PDF) when the model returns non-JSON", async () => {
    h.create.mockResolvedValueOnce({
      choices: [{ message: { content: "Just some freeform prose, not JSON." } }],
    } as never);
    const engramId = await insertEngram();
    const job = await createArtifactJob({
      ownerId: TEST_OWNER_ID,
      engramId,
      trigger: "operator",
      kind: "pdf",
      title: "Loose Thoughts",
      prompt: "anything",
    });

    await runArtifactTick();

    const done = await loadArtifactById(job.id);
    expect(done?.status).toBe("completed");
    const blob = await loadArtifactBlob(job.id);
    expect(blob!.data.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });

  it("fails closed for image/video (no provider) with a clear message; no blob written", async () => {
    const engramId = await insertEngram();
    const job = await createArtifactJob({
      ownerId: TEST_OWNER_ID,
      engramId,
      trigger: "operator",
      kind: "image",
      title: "A Vista",
      prompt: "a calm horizon",
    });

    await runArtifactTick();

    const done = await loadArtifactById(job.id);
    expect(done?.status).toBe("failed");
    expect(done?.error).toMatch(/no online generation provider is configured/i);
    expect(await loadArtifactBlob(job.id)).toBeUndefined();
  });

  it("requeues a failed job and clears the prior result + blob", async () => {
    const engramId = await insertEngram();
    const job = await createArtifactJob({
      ownerId: TEST_OWNER_ID,
      engramId,
      trigger: "operator",
      kind: "pdf",
      title: "Doc",
      prompt: "x",
    });
    await runArtifactTick();
    expect((await loadArtifactById(job.id))?.status).toBe("completed");
    expect(await loadArtifactBlob(job.id)).toBeDefined();

    // Force it into a failed state so requeue's status guard is satisfied.
    await db
      .update(engramArtifactsTable)
      .set({ status: "failed" })
      .where(eq(engramArtifactsTable.id, job.id));

    const requeued = await requeueArtifact(job.id);
    expect(requeued?.status).toBe("pending");
    expect(requeued?.sizeBytes).toBe(0);
    expect(requeued?.mimeType).toBeNull();
    expect(await loadArtifactBlob(job.id)).toBeUndefined();

    // A second concurrent-style requeue (no longer failed) updates zero rows.
    expect(await requeueArtifact(job.id)).toBeUndefined();
  });

  it("deletes an artifact and its bytes", async () => {
    const engramId = await insertEngram();
    const job = await createArtifactJob({
      ownerId: TEST_OWNER_ID,
      engramId,
      trigger: "operator",
      kind: "pdf",
      title: "Doc",
      prompt: "x",
    });
    await runArtifactTick();
    expect(await deleteArtifact(job.id)).toBe(true);
    expect(await loadArtifactById(job.id)).toBeUndefined();
    expect(await loadArtifactBlob(job.id)).toBeUndefined();
  });
});
