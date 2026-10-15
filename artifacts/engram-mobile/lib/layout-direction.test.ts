import { describe, expect, it } from "vitest";

import { isRtlLanguage } from "./layout-direction";

describe("isRtlLanguage", () => {
  it("recognizes Arabic base and regional language tags", () => {
    expect(isRtlLanguage("ar")).toBe(true);
    expect(isRtlLanguage("ar-EG")).toBe(true);
  });

  it("keeps supported LTR and unknown languages left-to-right", () => {
    expect(isRtlLanguage("en")).toBe(false);
    expect(isRtlLanguage("hi")).toBe(false);
    expect(isRtlLanguage("unknown")).toBe(false);
    expect(isRtlLanguage(undefined)).toBe(false);
  });
});