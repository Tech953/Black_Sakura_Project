import { describe, expect, it } from "vitest";

import { normalizeMediaUploadMimeType } from "@workspace/api-client-react";

describe("mobile document-picker MIME normalization", () => {
  it.each([
    ["photo.JPG", "image/jpg", "image/jpeg"],
    ["voice.mp3", "audio/mp3", "audio/mpeg"],
    ["voice.m4a", "application/octet-stream", "audio/mp4"],
    ["notes.json", "application/octet-stream", "application/json"],
    ["clip.mov", "video/quicktime; codecs=h264", "video/quicktime"],
  ])("normalizes %s reported as %s", (filename, reported, expected) => {
    expect(normalizeMediaUploadMimeType(filename, reported)).toBe(expected);
  });

  it("keeps an unknown generic picker result generic so the API can reject it clearly", () => {
    expect(normalizeMediaUploadMimeType("archive.bin", "application/octet-stream")).toBe(
      "application/octet-stream",
    );
  });
});