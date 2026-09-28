import { describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  },
}));

vi.mock("../lib/offline/mode", () => ({
  useOfflineMode: () => false,
}));

vi.mock("@workspace/api-client-react", () => ({
  getListEngramsQueryKey: () => ["/api/engrams"],
  useListEngrams: () => ({ data: undefined }),
}));

import {
  conversationMapKey,
  getEngramListModeQueryKey,
  resolveSelectedEngramId,
} from "./engram-context";
import type { Engram } from "@workspace/api-client-react";

const liveSlug = "rebecca-full-rezz-live";
const archiveSlug = "rebecca-full-rezz";

const onlineEngrams = [
  { id: 17, slug: archiveSlug },
  { id: 18, slug: liveSlug },
] as Engram[];

const offlineEngrams = [
  { id: 401, slug: archiveSlug },
  { id: 402, slug: liveSlug },
] as Engram[];

describe("backend-scoped engram selection", () => {
  it("translates both Full Rezz branches online → offline → online by slug", () => {
    for (const slug of [archiveSlug, liveSlug]) {
      const onlineId = resolveSelectedEngramId(
        slug,
        null,
        null,
        "online",
        onlineEngrams,
      );
      const offlineId = resolveSelectedEngramId(
        slug,
        onlineId,
        "online",
        "offline",
        offlineEngrams,
      );
      const returnedOnlineId = resolveSelectedEngramId(
        slug,
        offlineId,
        "offline",
        "online",
        onlineEngrams,
      );

      expect(onlineId).toBe(slug === liveSlug ? 18 : 17);
      expect(offlineId).toBe(slug === liveSlug ? 402 : 401);
      expect(returnedOnlineId).toBe(onlineId);
    }
  });

  it("does not reinterpret an unmigrated numeric ID in another backend", () => {
    expect(
      resolveSelectedEngramId(null, 17, "online", "offline", offlineEngrams),
    ).toBeNull();
    expect(
      resolveSelectedEngramId(null, 17, "online", "online", onlineEngrams),
    ).toBe(17);
  });

  it("scopes query and conversation identifiers to their backend", () => {
    expect(getEngramListModeQueryKey(false)).not.toEqual(
      getEngramListModeQueryKey(true),
    );
    expect(conversationMapKey(18, false)).not.toBe(
      conversationMapKey(18, true),
    );
  });
});