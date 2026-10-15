import { describe, expect, it } from "vitest";
import { EngramImportDraftStore } from "./engram-import-store";
import type { EngramImportDraft } from "./engram-import";

const draft = { name: "A" } as EngramImportDraft;

describe("EngramImportDraftStore", () => {
  it("expires drafts using its injected clock", () => {
    let now = 0;
    const store = new EngramImportDraftStore({ now: () => now });
    const id = store.create(draft);
    now = 20 * 60 * 1000;
    expect(store.get(id)).toBeNull();
  });

  it("blocks replay and permits retry only after release", () => {
    const store = new EngramImportDraftStore();
    const id = store.create(draft);
    expect(store.beginConfirm(id)).toBe(draft);
    expect(store.beginConfirm(id)).toBeNull();
    expect(store.release(id)).toBe(true);
    expect(store.beginConfirm(id)).toBe(draft);
    expect(store.consume(id)).toBe(true);
    expect(store.beginConfirm(id)).toBeNull();
    expect(store.release(id)).toBe(false);
  });
});