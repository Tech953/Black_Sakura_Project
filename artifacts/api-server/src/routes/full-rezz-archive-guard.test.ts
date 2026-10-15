import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, {
  type NextFunction,
  type Request,
  type Response as ExpressResponse,
} from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const mocks = vi.hoisted(() => ({
  importReferencePack: vi.fn(),
  getJob: vi.fn(),
  transaction: vi.fn(),
  loadOwnedEngram: vi.fn(),
  loadOwnedConversation: vi.fn(),
  reviewGeneration: vi.fn(),
  submitSpeech: vi.fn(),
  submitMovie: vi.fn(),
  previewHistory: vi.fn(),
  importHistory: vi.fn(),
  listHistory: vi.fn(),
  exportHistory: vi.fn(),
  rollbackHistory: vi.fn(),
  readOnlyError:
    "This engram is a permanent immutable archival branch. It is read-only; any future exception requires multistage executive confirmation.",
}));

vi.mock("@workspace/db", () => ({
  db: { transaction: mocks.transaction },
}));

vi.mock("@workspace/db/schema", () => ({
  engramsTable: { id: {}, ownerId: {}, isArchival: {}, voiceProfile: {} },
  messages: { id: {}, conversationId: {}, role: {}, speakerEngramId: {}, content: {} },
}));

vi.mock("../lib/archival", () => ({
  ARCHIVAL_READ_ONLY_ERROR: mocks.readOnlyError,
}));

vi.mock("../lib/account-bootstrap", () => ({
  loadOwnedEngram: mocks.loadOwnedEngram,
  loadOwnedConversation: mocks.loadOwnedConversation,
}));

vi.mock("../lib/full-rezz-worker", () => ({
  cancelFullRezzJob: vi.fn(),
  exportFullRezzHistory: mocks.exportHistory,
  fullRezzWorkspaceForOwner: vi.fn(),
  getFullRezzAudioPath: vi.fn(),
  getFullRezzMoviePath: vi.fn(),
  getFullRezzJob: mocks.getJob,
  getFullRezzRuntimeStatus: vi.fn(() => ({
    available: false,
    runtimeVersion: "3.0.0",
    reason: "Runtime is not staged.",
  })),
  importFullRezzReferencePack: mocks.importReferencePack,
  importFullRezzHistory: mocks.importHistory,
  listFullRezzHistory: mocks.listHistory,
  previewFullRezzHistory: mocks.previewHistory,
  previewFullRezzReferencePack: vi.fn(),
  reviewFullRezzGeneration: mocks.reviewGeneration,
  rollbackFullRezzImport: vi.fn(),
  rollbackFullRezzHistoryImport: mocks.rollbackHistory,
  submitFullRezzMovieExportJob: mocks.submitMovie,
  submitFullRezzSpeechJob: mocks.submitSpeech,
}));

vi.mock("../lib/full-rezz-contract", () => ({
  readFullRezzBinding: vi.fn(() => null),
}));

import fullRezzRouter from "./full-rezz";

describe("FULL_REZZ immutable archive guard", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    mocks.loadOwnedEngram.mockResolvedValue({
      id: 17,
      ownerId: "owner",
      isArchival: true,
      voiceProfile: { speechStyle: "preserved" },
    });
    const app = express();
    app.use(express.json());
    app.use((req: Request, _res: ExpressResponse, next: NextFunction) => {
      (req as Request & { userId: string }).userId = "owner";
      next();
    });
    app.use(fullRezzRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("rejects imports before runtime checks or worker/database writes", async () => {
    const form = new FormData();
    form.set("originalProfileId", "voice_57373fea79f3473e");
    form.set("file", new Blob(["not extracted"], { type: "application/zip" }), "pack.zip");

    const response = await fetch(`${base}/full-rezz/engrams/17/import`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.importReferencePack).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects archival history preview/import before invoking the history worker", async () => {
    const previewForm = new FormData();
    previewForm.set("file", new Blob(["[]"], { type: "application/json" }), "history.json");
    const preview = await fetch(`${base}/full-rezz/engrams/17/history/import-preview`, {
      method: "POST",
      body: previewForm,
    });
    expect(preview.status).toBe(409);
    expect(await preview.json()).toEqual({ error: mocks.readOnlyError });

    const importForm = new FormData();
    importForm.set("file", new Blob(["[]"], { type: "application/json" }), "history.json");
    const imported = await fetch(`${base}/full-rezz/engrams/17/history/import`, {
      method: "POST",
      body: importForm,
    });
    expect(imported.status).toBe(409);
    expect(await imported.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.previewHistory).not.toHaveBeenCalled();
    expect(mocks.importHistory).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("rejects archival history read/export and movie export before worker access", async () => {
    const history = await fetch(`${base}/full-rezz/engrams/17/history`);
    expect(history.status).toBe(409);
    expect(await history.json()).toEqual({ error: mocks.readOnlyError });

    const historyExport = await fetch(`${base}/full-rezz/engrams/17/history/export`);
    expect(historyExport.status).toBe(409);
    expect(await historyExport.json()).toEqual({ error: mocks.readOnlyError });

    mocks.loadOwnedConversation.mockResolvedValue({
      id: 3,
      ownerId: "owner",
      engramId: 17,
      archivedAt: null,
    });
    const movie = await fetch(
      `${base}/full-rezz/conversations/3/messages/99/movie-export`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    expect(movie.status).toBe(409);
    expect(await movie.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.listHistory).not.toHaveBeenCalled();
    expect(mocks.exportHistory).not.toHaveBeenCalled();
    const rollback = await fetch(
      `${base}/full-rezz/engrams/17/history/imports/import_0123456789abcdef0123456789abcdef`,
      { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) },
    );
    expect(rollback.status).toBe(409);
    expect(await rollback.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.rollbackHistory).not.toHaveBeenCalled();
    expect(mocks.submitMovie).not.toHaveBeenCalled();
  });

  it("rejects saved-reply speech before reading or starting an archival job", async () => {
    mocks.loadOwnedConversation.mockResolvedValue({
      id: 3,
      ownerId: "owner",
      engramId: 17,
      archivedAt: null,
    });

    const response = await fetch(
      `${base}/full-rezz/conversations/3/messages/99/speech`,
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.submitSpeech).not.toHaveBeenCalled();
  });

  it("rejects review writes before the worker when a job's engram is archival", async () => {
    mocks.getJob.mockResolvedValue({
      id: "9f2e6823-4053-4b16-b36c-8a5902f50475",
      status: "succeeded",
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      engramId: 17,
      messageId: 99,
      generationIds: ["gen_0123456789abcdef"],
    });

    const response = await fetch(
      `${base}/full-rezz/jobs/9f2e6823-4053-4b16-b36c-8a5902f50475/review`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          generationId: "gen_0123456789abcdef",
          ratings: {
            likeness: "acceptable",
            naturalness: "acceptable",
            delivery: "acceptable",
            reference_purity: "acceptable",
            canon_boundaries: "acceptable",
          },
        }),
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: mocks.readOnlyError });
    expect(mocks.reviewGeneration).not.toHaveBeenCalled();
  });

  it("serves allowlisted Studio Unit assets and rejects arbitrary paths", async () => {
    const view = await fetch(
      `${base}/full-rezz/studio-unit/assets/front.png`,
    );
    expect(view.status).toBe(200);
    expect(view.headers.get("content-type")).toContain("image/png");
    expect((await view.arrayBuffer()).byteLength).toBeGreaterThan(0);

    const model = await fetch(
      `${base}/full-rezz/studio-unit/assets/studio_unit.gltf`,
    );
    expect(model.status).toBe(200);
    expect(model.headers.get("content-type")).toContain("model/gltf+json");

    const arbitraryPath = await fetch(
      `${base}/full-rezz/studio-unit/assets/%2e%2e%2f..%2fpackage.json`,
    );
    expect(arbitraryPath.status).toBe(404);
  });
});
