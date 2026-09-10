import { describe, expect, it } from "vitest";

import {
  buildWebChatExport,
  downloadWebChatExport,
  type WebChatDownloadAnchor,
  type WebChatDownloadRuntime,
} from "./web-chat-export";

/**
 * The workspace has Chromium but no Firefox/WebKit binary or browser driver.
 * These engine-shaped runtimes exercise the production Blob/object-URL/anchor
 * contract for the browser differences that matter here:
 * Safari requires the anchor to be attached before click, while Firefox must
 * retain the object URL through the click before it is revoked.
 */
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
      content: "Hello browser compatibility",
    },
  ],
};

const formats = [
  ["md", "Signal-01.md", "text/markdown"],
  ["txt", "Signal-01.txt", "text/plain"],
  ["pdf", "Signal-01.pdf", "application/pdf"],
  [
    "docx",
    "Signal-01.docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
] as const;

function makeRuntime(
  engine: "safari" | "firefox",
  downloads: Array<{ filename: string; type: string; size: number }>,
): WebChatDownloadRuntime {
  const blobs = new Map<string, Blob>();
  const attached = new WeakSet<WebChatDownloadAnchor>();
  const revoked = new Set<string>();
  let nextUrl = 0;

  return {
    createBlob: (parts, mimeType) => new Blob(parts, { type: mimeType }),
    createObjectURL: (blob) => {
      const url = `blob:${engine}-${++nextUrl}`;
      blobs.set(url, blob);
      return url;
    },
    revokeObjectURL: (url) => {
      revoked.add(url);
    },
    createAnchor: () => {
      const anchor: WebChatDownloadAnchor = {
        href: "",
        download: "",
        rel: "",
        click: () => {
          if (engine === "safari" && !attached.has(anchor)) {
            throw new Error("Safari requires a download anchor to be attached");
          }
          const blob = blobs.get(anchor.href);
          if (!blob || (engine === "firefox" && revoked.has(anchor.href))) {
            throw new Error(`${engine} lost the download object URL before click`);
          }
          downloads.push({
            filename: anchor.download,
            type: blob.type,
            size: blob.size,
          });
        },
        remove: () => {},
      };
      return anchor;
    },
    appendAnchor: (anchor) => {
      attached.add(anchor);
    },
    schedule: (callback) => callback(),
  };
}

describe("web chat export browser compatibility", () => {
  it("preserves downloads across Safari- and Firefox-shaped runtimes", async () => {
    for (const engine of ["safari", "firefox"] as const) {
      const downloads: Array<{
        filename: string;
        type: string;
        size: number;
      }> = [];
      const runtime = makeRuntime(engine, downloads);

      for (const [format, filename, mimeType] of formats) {
        downloadWebChatExport(
          await buildWebChatExport(format, document, "Signal-01"),
          runtime,
        );
      }

      expect(downloads).toHaveLength(4);
      expect(downloads.map(({ filename, type }) => [filename, type])).toEqual(
        formats.map(([, filename, mimeType]) => [filename, mimeType]),
      );
      expect(downloads.every(({ size }) => size > 0)).toBe(true);
    }
  });
});