import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  buildTranscriptEntries,
} from "./chat-export";

test("chat export preserves human, speaker-attributed, and context messages with timestamps", () => {
  const entries = buildTranscriptEntries(
    [
      { role: "user", content: "Hello", createdAt: "2026-01-02T03:04:05.000Z" },
      { role: "assistant", content: "Welcome", speakerEngramId: 7, createdAt: "2026-01-02T03:05:05.000Z" },
      { role: "context", content: "A remembered detail", createdAt: "2026-01-02T03:06:05.000Z" },
      { role: "assistant", content: "  " },
    ],
    {
      you: "YOU",
      perceivedContext: "PERCEIVED CONTEXT",
      engramFallback: "ENGRAM",
      speakerName: (id) => `ENGRAM ${id}`,
      defaultAssistant: "PYRI",
    },
  );

  assert.deepEqual(entries, [
    { heading: "YOU", timestamp: "2026-01-02T03:04:05.000Z", content: "Hello" },
    { heading: "ENGRAM 7", timestamp: "2026-01-02T03:05:05.000Z", content: "Welcome" },
    { heading: "PERCEIVED CONTEXT", timestamp: "2026-01-02T03:06:05.000Z", content: "A remembered detail" },
  ]);
});

test("chat export uses the same ordered entries in Markdown and plain text", () => {
  const entries = [
    { heading: "YOU", timestamp: "2026-01-02T03:04:05.000Z", content: "Hello" },
    { heading: "ENGRAM 7", timestamp: "2026-01-02T03:05:05.000Z", content: "Welcome" },
    { heading: "PERCEIVED CONTEXT", timestamp: "2026-01-02T03:06:05.000Z", content: "A remembered detail" },
  ];
    const input = {
      title: "Shared room",
      downloadedOn: "Downloaded on",
      exportedAt: "2026-01-03T03:00:00.000Z",
      conversationCreated: "Conversation created",
      createdAt: "2026-01-02T03:00:00.000Z",
      entries,
    };
    const markdown = buildMarkdownTranscript(input);
    const plain = buildPlainTextTranscript(input);
    for (const value of ["Shared room", "YOU", "ENGRAM 7", "PERCEIVED CONTEXT", "Hello", "Welcome", "A remembered detail"]) {
      assert.ok(markdown.includes(value));
      assert.ok(plain.includes(value));
    }
    assert.ok(markdown.indexOf("Hello") < markdown.indexOf("Welcome"));
    assert.ok(plain.indexOf("Welcome") < plain.indexOf("A remembered detail"));
});