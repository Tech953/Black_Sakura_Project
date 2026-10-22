import { describe, expect, it } from "vitest";

import { getMediaUploadPercent } from "./media-upload-progress";

describe("getMediaUploadPercent", () => {
  it("returns a bounded percentage for computable upload events", () => {
    expect(getMediaUploadPercent(0, 200)).toBe(0);
    expect(getMediaUploadPercent(87, 200)).toBe(43);
    expect(getMediaUploadPercent(200, 200)).toBe(99);
    expect(getMediaUploadPercent(250, 200)).toBe(99);
  });

  it("returns null when the event cannot produce a meaningful percentage", () => {
    expect(getMediaUploadPercent(1, 0)).toBeNull();
    expect(getMediaUploadPercent(Number.NaN, 10)).toBeNull();
    expect(getMediaUploadPercent(1, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
