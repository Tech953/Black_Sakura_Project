import { describe, expect, it } from "vitest";

import {
  buildDocxBytes,
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  buildTranscriptEntries,
  escapeHtml,
} from "./chat-export";

const input = {
  title: "Signal <01>",
  downloadedOn: "Exported on",
  exportedAt: "2026-09-10T00:00:00.000Z",
  conversationCreated: "Conversation created",
  createdAt: "2026-09-09T00:00:00.000Z",
  entries: buildTranscriptEntries(
    [
      { role: "user" as const, content: "Hello", createdAt: "2026-09-10T00:01:00.000Z" },
      { role: "assistant" as const, content: "Welcome back", speakerEngramId: 7 },
    ],
    {
      you: "You",
      perceivedContext: "Context",
      engramFallback: "Engram",
      speakerName: (id) => `Engram ${id}`,
      defaultAssistant: "PYRI",
    },
  ),
};

describe("mobile chat exports", () => {
  it("builds transcript entries with speaker labels and timestamps", () => {
    expect(input.entries).toEqual([
      {
        heading: "You",
        timestamp: "2026-09-10T00:01:00.000Z",
        content: "Hello",
      },
      {
        heading: "Engram 7",
        timestamp: "",
        content: "Welcome back",
      },
    ]);
  });

  it("builds markdown and plain text variants", () => {
    expect(buildMarkdownTranscript(input)).toContain("# Signal <01>");
    expect(buildMarkdownTranscript(input)).toContain("## Engram 7");
    expect(buildPlainTextTranscript(input)).toContain("You\n2026-09-10T00:01:00.000Z\nHello");
  });

  it("builds a valid zipped DOCX payload and escapes HTML", () => {
    const docx = buildDocxBytes(input);
    expect(Array.from(docx.slice(0, 2))).toEqual([80, 75]);
    expect(escapeHtml("<hello>\nworld")).toBe("&lt;hello&gt;<br/>world");
  });
});