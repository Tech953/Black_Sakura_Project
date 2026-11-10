import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
const mocks = vi.hoisted(() => ({
  conversation: vi.fn(),
  engram: vi.fn(),
  select: vi.fn(),
  participants: vi.fn(),
  transcribe: vi.fn(),
  status: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ db: { select: mocks.select } }));
vi.mock("@workspace/db/schema", () => ({
  engramsTable: {},
  messages: {},
  conversationEngramParticipants: {
    conversationId: {},
    ownerId: {},
    engramId: {},
  },
}));
vi.mock("../lib/account-bootstrap", () => ({
  loadOwnedConversation: mocks.conversation,
  loadOwnedEngram: mocks.engram,
}));
vi.mock("../lib/full-rezz-worker", () => ({
  getFullRezzRuntimeStatus: mocks.status,
  transcribeFullRezzClip: mocks.transcribe,
  cancelFullRezzJob: vi.fn(),
  exportFullRezzHistory: vi.fn(),
  fullRezzWorkspaceForOwner: vi.fn(),
  getFullRezzMoviePath: vi.fn(),
  getFullRezzAudioPath: vi.fn(),
  getFullRezzJob: vi.fn(),
  importFullRezzHistory: vi.fn(),
  listFullRezzHistory: vi.fn(),
  importFullRezzReferencePack: vi.fn(),
  previewFullRezzHistory: vi.fn(),
  previewFullRezzReferencePack: vi.fn(),
  reviewFullRezzGeneration: vi.fn(),
  rollbackFullRezzHistoryImport: vi.fn(),
  rollbackFullRezzImport: vi.fn(),
  submitFullRezzMovieExportJob: vi.fn(),
  submitFullRezzSpeechJob: vi.fn(),
}));
import router from "./full-rezz";
describe("local microphone transcription", () => {
  let server: Server;
  let base: string;
  beforeAll(async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.userId = "owner";
      next();
    });
    app.use(router);
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.conversation.mockResolvedValue({
      id: 3,
      ownerId: "owner",
      engramId: 17,
      archivedAt: null,
    });
    mocks.engram.mockResolvedValue({ id: 17, isArchival: false });
    mocks.participants.mockResolvedValue([]);
    mocks.select.mockReturnValue({
      from: () => ({ where: mocks.participants }),
    });
    mocks.status.mockReturnValue({ available: true });
    mocks.transcribe.mockResolvedValue({
      text: "review this draft",
      language: "fr",
    });
  });
  function send(language = "fr", size = 100) {
    const form = new FormData();
    form.set("language", language);
    form.set(
      "file",
      new Blob([new Uint8Array(size)], { type: "audio/webm" }),
      "microphone.webm",
    );
    return fetch(`${base}/full-rezz/conversations/3/transcription`, {
      method: "POST",
      body: form,
    });
  }
  it("checks ownership before upload or inference", async () => {
    mocks.conversation.mockResolvedValue(null);
    expect((await send()).status).toBe(404);
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("blocks archived conversations and engrams before inference", async () => {
    mocks.conversation.mockResolvedValue({ id: 3, archivedAt: new Date() });
    expect((await send()).status).toBe(409);
    mocks.conversation.mockResolvedValue({
      id: 3,
      engramId: 17,
      archivedAt: null,
    });
    mocks.engram.mockResolvedValue({ isArchival: true });
    expect((await send()).status).toBe(409);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("blocks archival group participants", async () => {
    mocks.participants.mockResolvedValue([{ engramId: 18 }]);
    mocks.engram.mockImplementation(async (id) => ({
      id,
      isArchival: id === 18,
    }));
    expect((await send()).status).toBe(409);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("fails closed without a bundled runtime", async () => {
    mocks.status.mockReturnValue({ available: false, reason: "not staged" });
    expect((await send()).status).toBe(503);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("rejects unsupported language before inference", async () => {
    expect((await send("invalid")).status).toBe(422);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("routes language locally and deletes the temporary audio", async () => {
    let file = "";
    mocks.transcribe.mockImplementation(
      async (owner, path, language, signal) => {
        file = path;
        expect(owner).toBe("owner");
        expect(language).toBe("zh-Hans");
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(existsSync(file)).toBe(true);
        return { text: "review this draft" };
      },
    );
    const r = await send("zh");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      text: "review this draft",
      remote_inference: false,
      recording_retained: false,
    });
    await vi.waitFor(() => expect(existsSync(file)).toBe(false));
  });
  it("cleans up temporary audio when transcription fails", async () => {
    let file = "";
    mocks.transcribe.mockImplementation(async (_owner, path) => {
      file = path;
      throw new Error("bad audio");
    });
    expect((await send()).status).toBe(422);
    await vi.waitFor(() => expect(existsSync(file)).toBe(false));
  });
  it("rejects oversized clips before inference", async () => {
    expect((await send("en", 12 * 1024 * 1024 + 1)).status).toBe(413);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
});
