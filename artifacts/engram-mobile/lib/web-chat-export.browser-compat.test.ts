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

type BrowserProfile = {
  name: string;
  engine: "safari" | "firefox";
  mobile: boolean;
};

const desktopProfiles: BrowserProfile[] = [
  { name: "Safari", engine: "safari", mobile: false },
  { name: "Firefox", engine: "firefox", mobile: false },
];

const mobileProfiles: BrowserProfile[] = [
  { name: "iOS Safari", engine: "safari", mobile: true },
  { name: "Android Firefox", engine: "firefox", mobile: true },
];

function makeRuntime(
  profile: BrowserProfile,
  downloads: Array<{ filename: string; type: string; size: number; blob: Blob }>,
): WebChatDownloadRuntime {
  const blobs = new Map<string, Blob>();
  const attached = new WeakSet<WebChatDownloadAnchor>();
  const revoked = new Set<string>();
  let nextUrl = 0;

  return {
    createBlob: (parts, mimeType) => new Blob(parts, { type: mimeType }),
    createObjectURL: (blob) => {
      const url = `blob:${profile.engine}-${++nextUrl}`;
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
          if (profile.engine === "safari" && !attached.has(anchor)) {
            throw new Error(`${profile.name} requires a download anchor to be attached`);
          }
          const blob = blobs.get(anchor.href);
          if (!blob || (profile.engine === "firefox" && revoked.has(anchor.href))) {
            throw new Error(
              `${profile.name} lost the download object URL before click`,
            );
          }
          downloads.push({
            filename: anchor.download,
            type: blob.type,
            size: blob.size,
            blob,
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

async function expectDownloadsForProfile(profile: BrowserProfile): Promise<void> {
  const downloads: Array<{
    filename: string;
    type: string;
    size: number;
    blob: Blob;
  }> = [];
  const runtime = makeRuntime(profile, downloads);

  for (const [format] of formats) {
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

  const payloads = await Promise.all(
    downloads.map(async ({ blob, ...download }) => ({
      ...download,
      prefix: Array.from(
        new Uint8Array(await blob.arrayBuffer()).slice(0, 4),
      ),
    })),
  );
  expect(payloads.map(({ prefix }) => prefix)).toEqual([
    [35, 32, 83, 105],
    [83, 105, 103, 110],
    [37, 80, 68, 70],
    [80, 75, 3, 4],
  ]);
}

describe("web chat export browser compatibility", () => {
  it("preserves downloads across Safari- and Firefox-shaped runtimes", async () => {
    for (const profile of desktopProfiles) {
      await expectDownloadsForProfile(profile);
    }
  });

  it("preserves downloads across iOS Safari- and Android Firefox-shaped runtimes", async () => {
    for (const profile of mobileProfiles) {
      await expectDownloadsForProfile(profile);
    }
  });
});