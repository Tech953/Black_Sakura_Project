import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { storageFile, storageBucket, storageClientBucket } = vi.hoisted(() => {
  const storageFile = {
    exists: vi.fn(),
    getMetadata: vi.fn(),
  };
  const storageBucket = {
    file: vi.fn(() => storageFile),
  };
  const storageClientBucket = vi.fn(() => storageBucket);
  return { storageFile, storageBucket, storageClientBucket };
});

vi.mock("@google-cloud/storage", () => ({
  Storage: vi.fn().mockImplementation(function StorageMock() {
    return {
      bucket: storageClientBucket,
    };
  }),
}));

import { resolveStoredDesktopDownload } from "./download-storage";

describe("stored desktop download resolution", () => {
  beforeEach(() => {
    process.env["PUBLIC_OBJECT_SEARCH_PATHS"] = "/test-bucket";
    delete process.env["DESKTOP_DOWNLOAD_OBJECT_NAME"];
    storageClientBucket.mockClear();
    storageBucket.file.mockClear();
    storageFile.exists.mockReset();
    storageFile.getMetadata.mockReset();
  });

  afterEach(() => {
    delete process.env["PUBLIC_OBJECT_SEARCH_PATHS"];
    delete process.env["DESKTOP_DOWNLOAD_OBJECT_NAME"];
    vi.restoreAllMocks();
  });

  it("returns no installer when the configured object is missing", async () => {
    storageFile.exists.mockResolvedValue([false]);

    await expect(resolveStoredDesktopDownload()).resolves.toBeNull();

    expect(storageClientBucket).toHaveBeenCalledWith("test-bucket");
    expect(storageFile.getMetadata).not.toHaveBeenCalled();
  });

  it("returns no installer when object metadata has an invalid size", async () => {
    storageFile.exists.mockResolvedValue([true]);
    storageFile.getMetadata.mockResolvedValue([
      { size: "not-a-byte-count", updated: "2026-09-14T12:00:00Z" },
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("archive fetch must not occur"));

    await expect(resolveStoredDesktopDownload()).resolves.toBeNull();

    expect(storageFile.getMetadata).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns no installer when signing the object URL fails", async () => {
    storageFile.exists.mockResolvedValue([true]);
    storageFile.getMetadata.mockResolvedValue([
      { size: "2671959069", updated: "2026-09-14T12:00:00Z" },
    ]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("storage unavailable", { status: 503 }));

    await expect(resolveStoredDesktopDownload()).resolves.toBeNull();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:1106/object-storage/signed-object-url",
    );
  });

  it("returns no installer when App Storage returns no signed URL", async () => {
    storageFile.exists.mockResolvedValue([true]);
    storageFile.getMetadata.mockResolvedValue([{ size: "2671959069" }]);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({}), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    await expect(resolveStoredDesktopDownload()).resolves.toBeNull();

    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});