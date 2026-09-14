import { describe, expect, it } from "vitest";
import {
  clampProgress,
  statusText,
  type DesktopUpdateStatus,
} from "../../engram/src/components/desktop-update-banner-logic";

describe("desktop update banner accessibility contracts", () => {
  it("bounds progress values before exposing them to the progressbar", () => {
    expect(clampProgress(-12)).toBe(0);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(140)).toBe(100);
  });

  it("keeps useful announcements for ready, error, and manual states", () => {
    const statuses: DesktopUpdateStatus[] = [
      { state: "downloaded", version: "1.2.3" },
      { state: "error", message: "feed unavailable" },
      { state: "not-available", manual: true },
    ];

    expect(statuses.map(statusText)).toEqual([
      "Update 1.2.3 ready to install",
      "Update check failed",
      "ENGRAM is up to date",
    ]);
  });
});
