import { describe, expect, it } from "vitest";

import {
  needsWebmModalityChoice,
  normalizeMediaUploadMimeType,
} from "@workspace/api-client-react";

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

  it.each([
    ["", "audio", "audio/webm"],
    ["application/octet-stream; charset=binary", "video", "video/webm"],
  ] as const)(
    "requires an explicit choice for generic WebM picker MIME %s",
    (reported, modality, expected) => {
      expect(needsWebmModalityChoice("capture.WEBM", reported)).toBe(true);
      expect(normalizeMediaUploadMimeType("capture.WEBM", reported)).toBe(
        "application/octet-stream",
      );
      expect(normalizeMediaUploadMimeType("capture.WEBM", reported, modality)).toBe(expected);
    },
  );

  it("does not offer a WebM choice for a specific MIME or override its claim", () => {
    expect(needsWebmModalityChoice("capture.webm", "video/webm")).toBe(false);
    expect(normalizeMediaUploadMimeType("capture.webm", "application/pdf", "audio")).toBe(
      "application/pdf",
    );
  });
});