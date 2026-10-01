import { describe, expect, it } from "vitest";

import {
  HUB_ACTIVITY_EXCERPT_MAX,
  normalizeHubActivityExcerpt,
} from "./hub-activity-summary";

describe("normalizeHubActivityExcerpt", () => {
  it("collapses whitespace, trims, and applies the shared excerpt ceiling", () => {
    const excerpt = normalizeHubActivityExcerpt(
      `\n  first line\n\n\tsecond line   ${"x".repeat(HUB_ACTIVITY_EXCERPT_MAX + 80)}\n omitted tail`,
    );

    expect(excerpt).toMatch(/^first line second line /);
    expect(excerpt).not.toMatch(/[\r\n\t]/);
    expect(excerpt).not.toContain("omitted tail");
    expect(excerpt).toHaveLength(HUB_ACTIVITY_EXCERPT_MAX);
  });

  it("returns an empty excerpt for whitespace-only narrative", () => {
    expect(normalizeHubActivityExcerpt(" \n\t  ")).toBe("");
  });
});