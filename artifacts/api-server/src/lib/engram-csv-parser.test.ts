import { describe, expect, it } from "vitest";
import { MAX_ENGRAM_CSV_BYTES, parseEngramCsv } from "./engram-csv-parser";

describe("parseEngramCsv", () => {
  it("parses quoted commas and embedded newlines", () => {
    const result = parseEngramCsv(Buffer.from("speaker,content,timestamp\nUSER,\"hello, there\nagain\",2025-01-01"), "chat.csv");
    expect(result.ok && result.rows).toEqual([{ speaker: "USER", content: "hello, there\nagain", timestamp: "2025-01-01", sourceRow: 2 }]);
  });

  it("recovers common unquoted dialogue columns", () => {
    const result = parseEngramCsv(Buffer.from("speaker,content\nASSISTANT,one, two, three"), "export.CSV");
    expect(result.ok && result.rows[0].content).toBe("one,two,three");
    expect(result.ok && result.warnings.map((warning) => warning.code)).toContain("JOINED_OVERFLOW_COLUMNS");
  });

  it("handles marker-only transcript lines and strips boilerplate", () => {
    const result = parseEngramCsv(Buffer.from("\uFEFFUSER: hello\nASSISTANT: hi\n[laughs softly]\nTranscribed by Example"), "chat.csv");
    expect(result.ok && result.rows).toEqual([
      { speaker: "USER", content: "hello", timestamp: null, sourceRow: 1 },
      { speaker: "ASSISTANT", content: "hi", timestamp: null, sourceRow: 2 },
      { speaker: null, content: "[laughs softly]", timestamp: null, sourceRow: 3 },
    ]);
  });

  it("rejects non-CSV, binary, and oversized uploads", () => {
    expect(parseEngramCsv(Buffer.from("hello"), "chat.txt").ok).toBe(false);
    expect(parseEngramCsv(Buffer.from([0, 1]), "chat.csv").ok).toBe(false);
    expect(parseEngramCsv(Buffer.alloc(MAX_ENGRAM_CSV_BYTES + 1), "chat.csv").ok).toBe(false);
  });
});