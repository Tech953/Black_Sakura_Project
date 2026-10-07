import { routeHarness as h } from "../test/db-harness";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: h.db }));
vi.mock("@workspace/db/schema", () => h.schema);
vi.mock("drizzle-orm", () => h.drizzle);

import {
  markMessagesSeen,
  markOperatorRepliesAcknowledged,
  recentHumanCounts,
} from "./messages-store";

function seedOwner() {
  h.state.engrams = [
    { id: 1, ownerId: "test-owner", name: "Testra" },
    { id: 2, ownerId: "other-owner", name: "Other" },
  ];
}

beforeEach(() => {
  h.reset();
  seedOwner();
});

describe("markMessagesSeen", () => {
  it("updates only human-channel messages owned by the requesting account", async () => {
    h.state.messages = [
      {
        id: 1,
        fromEngramId: 1,
        channel: "human",
        seen: false,
      },
      {
        id: 2,
        fromEngramId: 1,
        channel: "engram",
        seen: false,
      },
    ];

    const updated = await markMessagesSeen("test-owner", [1, 2]);

    expect(updated).toBe(1);
    expect(h.state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 1, seen: true }),
        expect.objectContaining({ id: 2, seen: false }),
      ]),
    );
  });
});

describe("recentHumanCounts", () => {
  it("counts only engram-authored delivered contact inside the rolling windows", async () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    const at = (minutesAgo: number) =>
      new Date(now.getTime() - minutesAgo * 60 * 1000);

    h.state.messages = [
      { id: 1, fromEngramId: 1, channel: "human", author: "engram", status: "delivered", createdAt: at(15) },
      { id: 2, fromEngramId: 1, channel: "human", author: "engram", status: "queued", createdAt: at(120) },
      { id: 3, fromEngramId: 1, channel: "human", author: "engram", status: "digest", createdAt: at(23 * 60) },
      { id: 4, fromEngramId: 1, channel: "human", author: "engram", status: "blocked", createdAt: at(5) },
      { id: 5, fromEngramId: 1, channel: "human", author: "engram", status: "delivered", createdAt: at(25 * 60) },
      { id: 6, fromEngramId: 1, channel: "human", author: "operator", status: "delivered", createdAt: at(5) },
      { id: 7, fromEngramId: 2, channel: "human", author: "engram", status: "delivered", createdAt: at(5) },
    ];

    await expect(recentHumanCounts("test-owner", 1, now)).resolves.toEqual({
      hour: 1,
      day: 3,
    });
  });
});

describe("markOperatorRepliesAcknowledged", () => {
  it("acknowledges only pending operator replies owned by the addressed engram", async () => {
    h.state.messages = [
      {
        id: 10,
        fromEngramId: 1,
        channel: "human",
        author: "operator",
        acknowledgedAt: null,
      },
      {
        id: 11,
        fromEngramId: 1,
        channel: "human",
        author: "operator",
        acknowledgedAt: new Date("2026-09-13T12:00:00.000Z"),
      },
      {
        id: 12,
        fromEngramId: 2,
        channel: "human",
        author: "operator",
        acknowledgedAt: null,
      },
      {
        id: 13,
        fromEngramId: 1,
        channel: "engram",
        author: "operator",
        acknowledgedAt: null,
      },
    ];

    const now = new Date("2026-09-13T12:05:00.000Z");
    await expect(
      markOperatorRepliesAcknowledged("test-owner", 1, [10, 11, 12, 13], now),
    ).resolves.toBe(1);

    expect(h.state.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 10, acknowledgedAt: now }),
        expect.objectContaining({
          id: 11,
          acknowledgedAt: new Date("2026-09-13T12:00:00.000Z"),
        }),
        expect.objectContaining({ id: 12, acknowledgedAt: null }),
        expect.objectContaining({ id: 13, acknowledgedAt: null }),
      ]),
    );
  });
});