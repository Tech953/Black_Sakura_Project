import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  downloadOfflineModel,
  hasOfflineModelSync,
  offlineModelPartialPath,
  offlineModelPath,
  removeOfflineModel,
  type OfflineModelSpec,
} from "./offline-model";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections?.();
        }),
    ),
  );
});

async function serve(
  body: Buffer,
  options: { supportsRange?: boolean; slow?: boolean } = {},
): Promise<{ spec: OfflineModelSpec; ranges: string[] }> {
  const ranges: string[] = [];
  const server = createServer((request, response) => {
    const range = request.headers.range;
    if (range) ranges.push(range);
    let start = 0;
    if (options.supportsRange && range) {
      start = Number(range.match(/bytes=(\d+)-/)?.[1] ?? 0);
      response.writeHead(206, {
        "Content-Length": body.length - start,
        "Content-Range": `bytes ${start}-${body.length - 1}/${body.length}`,
      });
    } else {
      response.writeHead(200, { "Content-Length": body.length });
    }
    const payload = body.subarray(start);
    if (!options.slow) {
      response.end(payload);
      return;
    }
    let offset = 0;
    const timer = setInterval(() => {
      const chunk = payload.subarray(offset, offset + 256);
      offset += chunk.length;
      if (chunk.length) response.write(chunk);
      if (offset >= payload.length) {
        clearInterval(timer);
        response.end();
      }
    }, 5);
    response.on("close", () => clearInterval(timer));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not start");
  return {
    ranges,
    spec: {
      filename: "test-model.gguf",
      url: `http://127.0.0.1:${address.port}/model.gguf`,
      expectedBytes: body.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    },
  };
}

function modelBytes(size = 8_192): Buffer {
  const body = Buffer.alloc(size, 7);
  body.write("GGUF", 0, "ascii");
  body.writeUInt32LE(3, 4);
  return body;
}

describe("offline model download", () => {
  it("resumes a partial file with an HTTP range and atomically verifies it", async () => {
    const body = modelBytes();
    const { spec, ranges } = await serve(body, { supportsRange: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "engram-offline-model-"));
    await writeFile(offlineModelPartialPath(root, spec), body.subarray(0, 1_024));

    const result = await downloadOfflineModel(root, { spec });

    expect(ranges).toEqual(["bytes=1024-"]);
    expect(result.size).toBe(body.length);
    expect(await readFile(offlineModelPath(root, spec))).toEqual(body);
    expect(hasOfflineModelSync(root, spec)).toBe(true);
    await expect(readFile(offlineModelPartialPath(root, spec))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("restarts cleanly when a server ignores resume and returns the full body", async () => {
    const body = modelBytes();
    const { spec, ranges } = await serve(body, { supportsRange: false });
    const root = await mkdtemp(path.join(os.tmpdir(), "engram-offline-model-"));
    await writeFile(offlineModelPartialPath(root, spec), body.subarray(0, 1_024));

    await downloadOfflineModel(root, { spec });

    expect(ranges).toEqual(["bytes=1024-"]);
    expect(await readFile(offlineModelPath(root, spec))).toEqual(body);
  });

  it("rejects a checksum mismatch and removes the corrupt partial", async () => {
    const body = modelBytes();
    const { spec } = await serve(body);
    const root = await mkdtemp(path.join(os.tmpdir(), "engram-offline-model-"));
    const wrongSpec = { ...spec, sha256: "0".repeat(64) };

    await expect(downloadOfflineModel(root, { spec: wrongSpec })).rejects.toThrow(
      "SHA-256 mismatch",
    );
    await expect(readFile(offlineModelPath(root, wrongSpec))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(readFile(offlineModelPartialPath(root, wrongSpec))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves a partial file when cancellation interrupts a download", async () => {
    const body = modelBytes(32_768);
    const { spec } = await serve(body, { slow: true });
    const root = await mkdtemp(path.join(os.tmpdir(), "engram-offline-model-"));
    const controller = new AbortController();
    let cancelled = false;

    await expect(
      downloadOfflineModel(root, {
        spec,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!cancelled && progress.downloadedBytes > 0) {
            cancelled = true;
            controller.abort();
          }
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    const partial = await readFile(offlineModelPartialPath(root, spec));
    expect(partial.length).toBeGreaterThan(0);
    expect(partial.length).toBeLessThan(body.length);
    await removeOfflineModel(root, spec);
    await expect(readFile(offlineModelPartialPath(root, spec))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});