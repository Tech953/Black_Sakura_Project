import { describe, expect, it } from "vitest";

import { getOperatorReplyDisplayState } from "./reply-acknowledgement";

describe("operator reply acknowledgement display", () => {
  it("shows a server-saved reply as pending until acknowledgedAt is present", () => {
    expect(
      getOperatorReplyDisplayState({
        author: "operator",
        acknowledgedAt: null,
      }),
    ).toEqual({ saved: true, acknowledgement: "pending" });
  });

  it("shows a reply as acknowledged when the server supplies acknowledgedAt", () => {
    expect(
      getOperatorReplyDisplayState({
        author: "operator",
        acknowledgedAt: "2026-10-07T12:00:00.000Z",
      }),
    ).toEqual({ saved: true, acknowledgement: "acknowledged" });
  });

  it("does not treat an offline sync receipt as an ENGRAM acknowledgement", () => {
    const offlineReplyAfterReceipt = {
      author: "operator",
      acknowledgedAt: null,
      syncedAt: "2026-10-07T12:00:00.000Z",
    } as const;

    expect(getOperatorReplyDisplayState(offlineReplyAfterReceipt)).toEqual({
      saved: true,
      acknowledgement: "pending",
    });
  });

  it("does not show reply acknowledgement badges for incoming messages", () => {
    expect(
      getOperatorReplyDisplayState({
        author: "engram",
        acknowledgedAt: null,
      }),
    ).toBeNull();
  });
});
