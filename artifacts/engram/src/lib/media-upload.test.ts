import { describe, expect, it } from "vitest";

import { normalizeMediaUploadMimeType } from "@workspace/api-client-react";

describe("web browser-file MIME normalization", () => {
  it.each([
    ["report.md", "", "text/markdown"],
    ["table.csv", "application/octet-stream", "text/csv"],
    ["camera.jpeg", "image/jpeg; charset=binary", "image/jpeg"],
    ["recording.wav", "audio/x-wav", "audio/wav"],
    ["movie.mp4", "video/mp4", "video/mp4"],
  ])("prepares %s when the browser reports %s", (filename, reported, expected) => {
    expect(normalizeMediaUploadMimeType(filename, reported)).toBe(expected);
  });

  it("does not reinterpret a specific unsupported browser MIME from the extension", () => {
    expect(normalizeMediaUploadMimeType("notes.txt", "application/pdf")).toBe("application/pdf");
  });
});