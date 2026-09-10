import { describe, expect, it } from "vitest";

import {
  BROWSER_UNICODE_FONT_STACK,
  buildBrowserPdfBytes,
  buildWebChatExport,
  type BrowserPdfRuntime,
} from "./web-chat-export";

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
  it("returns browser-download metadata and non-empty bodies for every format", async () => {
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
      const exported = await buildWebChatExport(format, document, "Signal-01");
      const size =
        typeof exported.body === "string"
          ? new TextEncoder().encode(exported.body).byteLength
          : exported.body.byteLength;

      expect(exported.filename).toBe(filename);
      expect(exported.mimeType).toBe(mimeType);
      expect(size).toBeGreaterThan(0);
    }
  });

  it("renders multilingual PDF text with the bundled Unicode font stack", () => {
    const rendered: string[] = [];
    const runtime: BrowserPdfRuntime = {
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => ({
          fillStyle: "",
          font: "",
          textAlign: "left" as const,
          direction: "ltr" as const,
          fillRect: () => {},
          fillText: (text: string) => rendered.push(text),
          measureText: (text: string) => ({ width: text.length * 32 }),
        }),
        toDataURL: () => "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==",
      }),
    };
    const multilingual = {
      ...document,
      title: "Café 你好 Привет مرحبا",
      entries: [
        {
          heading: "You",
          timestamp: "",
          content: "Accents: déjà vu · CJK: 你好 · Cyrillic: Привет · Arabic: مرحبا",
        },
      ],
    };

    const pdf = buildBrowserPdfBytes(multilingual, runtime);
    const pdfText = new TextDecoder().decode(pdf);

    expect(BROWSER_UNICODE_FONT_STACK).toContain("Engram Noto CJK");
    expect(BROWSER_UNICODE_FONT_STACK).toContain("Engram Noto Arabic");
    expect(BROWSER_UNICODE_FONT_STACK).toContain("Engram Noto Cyrillic");
    expect(BROWSER_UNICODE_FONT_STACK).toContain("Engram Noto Latin");
    expect(new TextDecoder().decode(pdf.slice(0, 8))).toBe("%PDF-1.4");
    expect(Array.from(pdf).some((byte, index) => byte === 0xff && pdf[index + 1] === 0xd8)).toBe(true);
    expect(pdfText).toContain("/ToUnicode");
    expect(pdfText).toContain("3 Tr");
    expect(pdfText).toContain("<4F60>");
    expect(pdfText).toContain("<041F>");
    expect(pdfText).toContain("<0645>");
    expect(rendered.join(" ")).toContain("Café");
    expect(rendered.join(" ")).toContain("你好");
    expect(rendered.join(" ")).toContain("Привет");
    expect(rendered.join(" ")).toContain("مرحبا");
  });
});