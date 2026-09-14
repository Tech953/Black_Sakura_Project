import { describe, expect, it } from "vitest";
import settings from "../../../lib/i18n/src/en/settings.json";
import {
  clampProgress,
  statusText,
  type DesktopUpdateCopy,
  type DesktopUpdateStatus,
} from "../../engram/src/components/desktop-update-banner-logic";

describe("desktop update banner accessibility contracts", () => {
  const copy: DesktopUpdateCopy = settings.update;

  it("bounds progress values before exposing them to the progressbar", () => {
    expect(clampProgress(-12)).toBe(0);
    expect(clampProgress(42.6)).toBe(43);
    expect(clampProgress(140)).toBe(100);
  });

  it("uses the shared Settings copy for every updater state", () => {
    const statuses: DesktopUpdateStatus[] = [
      { state: "checking" },
      { state: "available", version: "1.2.3" },
      { state: "downloading", percent: 42.6 },
      { state: "downloaded", version: "1.2.3" },
      { state: "error", message: "feed unavailable" },
      { state: "not-available", manual: true },
    ];

    expect(statuses.map((status) => statusText(status, copy))).toEqual([
      copy.checking,
      copy.availableWithVersion.replace("{{version}}", "1.2.3"),
      copy.downloading.replace("{{percent}}", "43"),
      copy.downloaded,
      copy.error,
      copy.upToDate,
    ]);
  });
});
