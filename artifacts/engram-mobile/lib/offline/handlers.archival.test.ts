import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  completeOnce: vi.fn(),
  getEngram: vi.fn(),
  getEngramPersona: vi.fn(),
  isArchivalEngram: vi.fn(),
  activateEngram: vi.fn(),
  insertInquiry: vi.fn(),
  insertTransmission: vi.fn(),
  markTransmissionsSeen: vi.fn(),
  createConversation: vi.fn(),
}));

vi.mock("./llm", () => ({ completeOnce: h.completeOnce }));
vi.mock("../i18n", () => ({
  resolveReplyLanguage: vi.fn(async () => "en"),
}));
vi.mock("./store", () => ({
  OFFLINE_ARCHIVAL_READ_ONLY_ERROR: "archive is read-only",
  getEngram: h.getEngram,
  getEngramPersona: h.getEngramPersona,
  isArchivalEngram: h.isArchivalEngram,
  activateEngram: h.activateEngram,
  insertInquiry: h.insertInquiry,
  insertTransmission: h.insertTransmission,
  markTransmissionsSeen: h.markTransmissionsSeen,
  createConversation: h.createConversation,
}));

import { offlineHandler } from "./handlers";

const archive = {
  id: 77,
  slug: "rebecca-full-rezz",
  name: "Rebecca (Full Rezz)",
  isArchival: true,
};

async function request(method: string, path: string, body?: unknown) {
  return offlineHandler({
    method,
    path,
    body: body === undefined ? undefined : JSON.stringify(body),
  } as Parameters<typeof offlineHandler>[0]);
}

describe("offline archival route guards", () => {
  beforeEach(() => {
    for (const mock of Object.values(h)) mock.mockReset();
    h.getEngram.mockResolvedValue(archive);
    h.getEngramPersona.mockResolvedValue(archive);
    h.isArchivalEngram.mockResolvedValue(true);
  });

  it.each([
    ["activate", "POST", "/api/engrams/77/activate", undefined],
    [
      "probe",
      "POST",
      "/api/engrams/77/inquiries",
      { kind: "probe", question: "Can you change?" },
    ],
    [
      "develop",
      "POST",
      "/api/engrams/77/inquiries",
      { kind: "develop", question: "Please change." },
    ],
    ["transmit", "POST", "/api/engrams/77/transmit", undefined],
    [
      "mark seen",
      "POST",
      "/api/engrams/77/transmissions/mark-seen",
      { ids: [1] },
    ],
    [
      "create conversation",
      "POST",
      "/api/openai/conversations",
      { title: "No", mode: "companion", engramId: 77 },
    ],
  ])("returns 403 for archival %s", async (_name, method, path, body) => {
    await expect(request(method, path, body)).resolves.toEqual({
      status: 403,
      body: { error: "archive is read-only" },
    });
    expect(h.completeOnce).not.toHaveBeenCalled();
    expect(h.activateEngram).not.toHaveBeenCalled();
    expect(h.insertInquiry).not.toHaveBeenCalled();
    expect(h.insertTransmission).not.toHaveBeenCalled();
    expect(h.markTransmissionsSeen).not.toHaveBeenCalled();
    expect(h.createConversation).not.toHaveBeenCalled();
  });
});