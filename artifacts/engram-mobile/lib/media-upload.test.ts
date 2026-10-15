import { describe, expect, it } from "vitest";

import {
  needsWebmModalityChoice,
  normalizeMediaUploadMimeType,
} from "@workspace/api-client-react";

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

  it.each([
    ["", "audio", "audio/webm"],
    ["application/octet-stream", "video", "video/webm"],
  ] as const)(
    "asks for an explicit WebM modality when the picker reports %s",
    (reported, modality, expected) => {
      expect(needsWebmModalityChoice("camera.webm", reported)).toBe(true);
      expect(normalizeMediaUploadMimeType("camera.webm", reported)).toBe(
        "application/octet-stream",
      );
      expect(normalizeMediaUploadMimeType("camera.webm", reported, modality)).toBe(expected);
    },
  );

  it("preserves specific picker MIME claims for WebM filenames", () => {
    expect(needsWebmModalityChoice("camera.webm", "image/png")).toBe(false);
    expect(normalizeMediaUploadMimeType("camera.webm", "image/png", "audio")).toBe("image/png");
  });
});