import { describe, expect, it } from "vitest";

import { buildWebChatExport } from "./web-chat-export";

const document = {
  title: "Signal <01>",
  downloadedOn: "Exported on",
  exportedAt: "2026-09-10T00:01:00.000Z",
  conversationCreated: "Conversation created",
  createdAt: "2026-09-09T00:00:00.000Z",
  entries: [
    {
      heading: "You",
      timestamp: "2026-09-10T00:01:00.000Z",
      content: "Hello web export",
    },
  ],
};

describe("web chat exports", () => {
  it("returns browser-download metadata and non-empty bodies for every format", () => {
    const expected = [
      ["md", "Signal-01.md", "text/markdown"],
      ["txt", "Signal-01.txt", "text/plain"],
      ["pdf", "Signal-01.pdf", "application/pdf"],
      [
        "docx",
        "Signal-01.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    ] as const;

    for (const [format, filename, mimeType] of expected) {
      const exported = buildWebChatExport(format, document, "Signal-01");
      const size =
        typeof exported.body === "string"
          ? new TextEncoder().encode(exported.body).byteLength
          : exported.body.byteLength;

      expect(exported.filename).toBe(filename);
      expect(exported.mimeType).toBe(mimeType);
      expect(size).toBeGreaterThan(0);
    }
  });
});