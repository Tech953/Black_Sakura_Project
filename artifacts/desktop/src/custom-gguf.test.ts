import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomGgufStore, type CustomGgufMetadata } from "./custom-gguf";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gguf-store-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function gguf(version = 3, size = 128): Buffer {
  const value = Buffer.alloc(size, 0x5a);
  value.write("GGUF", 0, "ascii");
  value.writeUInt32LE(version, 4);
  return value;
}

async function fixture(
  bytes = gguf(),
): Promise<{ root: string; source: string; store: CustomGgufStore }> {
  const parent = await temporaryDirectory();
  const root = path.join(parent, "managed");
  const source = path.join(parent, "source.gguf");
  await writeFile(source, bytes);
  return {
    root,
    source,
    store: new CustomGgufStore(root, {
      minBytes: 8,
      maxBytes: 1024,
      freeSpaceHeadroomBytes: 0,
      getFreeSpaceBytes: async () => 10_000,
      progressThrottleMs: 0,
    }),
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("CustomGgufStore", () => {
  it.each([
    [Buffer.from("NOPE0000"), "signature"],
    [gguf(0), "version"],
    [gguf(4), "version"],
  ])("rejects malformed header (%s)", async (bytes) => {
    const { source, store } = await fixture(bytes);
    await expect(store.inspect(source)).rejects.toThrow();
  });

  it("rejects implausibly small and large files", async () => {
    const small = await fixture(gguf(3, 8));
    const large = await fixture(gguf(3, 129));
    const smallStore = new CustomGgufStore(small.root, { minBytes: 9 });
    const largeStore = new CustomGgufStore(large.root, {
      minBytes: 8,
      maxBytes: 128,
    });
    await expect(smallStore.inspect(small.source)).rejects.toThrow(/range/);
    await expect(largeStore.inspect(large.source)).rejects.toThrow(/range/);
  });

  it("rejects a symlink source", async () => {
    const { source, root } = await fixture();
    const link = path.join(path.dirname(source), "link.gguf");
    await symlink(source, link);
    const store = new CustomGgufStore(root, { minBytes: 8 });
    await expect(store.inspect(link)).rejects.toThrow(/symlink/);
  });

  it("checks free space including headroom before creating a partial", async () => {
    const { source, root } = await fixture();
    const store = new CustomGgufStore(root, {
      minBytes: 8,
      freeSpaceHeadroomBytes: 20,
      getFreeSpaceBytes: async () => 147,
    });
    await expect(store.import(source)).rejects.toThrow(/free space/);
    expect(await readdir(root)).toEqual([]);
  });

  it("copies, reports progress, fingerprints, and verifies the managed file", async () => {
    const bytes = gguf();
    const { source, store } = await fixture(bytes);
    const onProgress = vi.fn();
    const metadata = await store.import(source, { onProgress });
    expect(metadata).toMatchObject({
      path: `${createHash("sha256").update(bytes).digest("hex")}.gguf`,
      originalFilename: "source.gguf",
      byteSize: bytes.length,
      ggufVersion: 3,
    });
    expect(metadata.sha256).toHaveLength(64);
    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)?.[0]).toMatchObject({
      copiedBytes: bytes.length,
      totalBytes: bytes.length,
      fraction: 1,
    });
    await expect(store.verify(metadata)).resolves.toMatch(/\.gguf$/);
  });

  it("rejects modified, truncated, and missing managed files", async () => {
    const first = await fixture();
    const modified = await first.store.import(first.source);
    const managed = await first.store.resolve(modified);
    await writeFile(managed, gguf(2));
    await expect(first.store.verify(modified)).rejects.toThrow();

    const second = await fixture();
    const truncated = await second.store.import(second.source);
    await truncate(await second.store.resolve(truncated), 9);
    await expect(second.store.verify(truncated)).rejects.toThrow(/size/);

    const third = await fixture();
    const missing = await third.store.import(third.source);
    await unlink(await third.store.resolve(missing));
    await expect(third.store.verify(missing)).rejects.toThrow();
  });

  it("rejects traversal metadata and managed symlinks", async () => {
    const { source, root, store } = await fixture();
    const metadata = await store.import(source);
    await expect(
      store.resolve({ path: "../source.gguf" }),
    ).rejects.toThrow(/basename/);
    await unlink(path.join(root, metadata.path));
    await symlink(source, path.join(root, metadata.path));
    await expect(store.verify(metadata)).rejects.toThrow(/symlink/);
  });

  it("rejects a managed file replaced after full verification", async () => {
    const { source, root, store } = await fixture();
    const metadata = await store.import(source);
    const verified = await store.verifyForLaunch(metadata);
    const replacement = path.join(path.dirname(source), "replacement.gguf");
    await writeFile(replacement, gguf());
    await rename(replacement, path.join(root, metadata.path));
    await expect(store.assertLaunchIdentity(verified)).rejects.toThrow(
      /changed before launch/,
    );
  });

  it("cleans partial files after cancellation and callback failure", async () => {
    const cancelled = await fixture();
    const controller = new AbortController();
    await expect(
      cancelled.store.import(cancelled.source, {
        signal: controller.signal,
        onProgress: () => controller.abort(),
      }),
    ).rejects.toThrow();
    expect((await readdir(cancelled.root)).filter((name) => name.endsWith(".partial"))).toEqual([]);

    const failed = await fixture();
    await expect(
      failed.store.import(failed.source, {
        onProgress: () => {
          throw new Error("progress failed");
        },
      }),
    ).rejects.toThrow("progress failed");
    expect((await readdir(failed.root)).filter((name) => name.endsWith(".partial"))).toEqual([]);
  });

  it("removes stale partials without touching adjacent files", async () => {
    const { root, store } = await fixture();
    await mkdir(root);
    await writeFile(path.join(root, "old.partial"), "partial");
    await writeFile(path.join(root, "keep.txt"), "keep");
    await store.cleanStalePartials();
    expect(await readdir(root)).toEqual(["keep.txt"]);
  });

  it("remove requires complete verified metadata", async () => {
    const { source, store } = await fixture();
    const metadata = await store.import(source);
    const forged: CustomGgufMetadata = { ...metadata, byteSize: 9 };
    await expect(store.remove(forged)).rejects.toThrow();
    await expect(store.resolve(metadata)).resolves.toBeTruthy();
  });
});