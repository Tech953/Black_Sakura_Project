import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  openDatabaseAsync: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: mocks.openDatabaseAsync,
}));
vi.mock("@workspace/db/seed/engram-data", () => ({
  engramSeedData: [],
}));

let getDb: typeof import("./store").getDb;

describe("offline SQLite failure harness", () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.openDatabaseAsync.mockReset();
    ({ getDb } = await import("./store"));
  });

  it("allows initialization to retry after SQLite open failure", async () => {
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    };
    mocks.openDatabaseAsync
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce(database);

    await expect(getDb()).rejects.toThrow("database unavailable");
    await expect(getDb()).resolves.toBe(database);
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("shares SQLite initialization while the first open is still pending", async () => {
    let finish!: () => void;
    const database = {
      execAsync: vi.fn(async () => {}),
      runAsync: vi.fn(async () => ({ lastInsertRowId: 1, changes: 1 })),
    };
    mocks.openDatabaseAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(database);
        }),
    );

    const first = getDb();
    const second = getDb();
    expect(mocks.openDatabaseAsync).toHaveBeenCalledTimes(1);

    finish();
    await expect(first).resolves.toBe(database);
    await expect(second).resolves.toBe(database);
  });
});