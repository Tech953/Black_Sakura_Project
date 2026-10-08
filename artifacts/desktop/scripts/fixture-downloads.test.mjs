import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LLAMA_VERSION,
  prepareLlamaRuntime,
} from "./prepare-llama-runtime.mjs";
import { downloadSmokeGguf } from "./download-smoke-gguf.mjs";

const temporaryDirectories = [];

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "engram-desktop-fixture-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function responseWithInterruptedBody() {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("partial fixture"));
        controller.error(new Error("fixture download interrupted"));
      },
    }),
  );
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("prepareLlamaRuntime fixture cache", () => {
  async function makeRuntimeFixture() {
    const cache = await makeTemporaryDirectory();
    const archiveBytes = Buffer.from("verified runtime archive fixture");
    const asset = {
      name: "llama-test-runtime.tar.gz",
      sha256: sha256(archiveBytes),
    };
    const archive = path.join(cache, asset.name);
    const temporary = `${archive}.${process.pid}.partial`;
    const executableDirectory = path.join(cache, `llama-${LLAMA_VERSION}`);
    const executable = path.join(executableDirectory, "llama-server");
    const spawnSyncImpl = vi.fn(() => {
      mkdirSync(executableDirectory, { recursive: true });
      writeFileSync(executable, "test executable");
      return { status: 0 };
    });
    const baseOptions = {
      platform: "linux",
      architecture: "x64",
      cache,
      assetCatalog: { "linux-x64": asset },
      releaseBase: "https://fixture.invalid/runtime",
      spawnSyncImpl,
    };

    return {
      archive,
      archiveBytes,
      asset,
      baseOptions,
      executable,
      spawnSyncImpl,
      temporary,
    };
  }

  it("uses a valid cached runtime archive without a network request", async () => {
    const fixture = await makeRuntimeFixture();
    await writeFile(fixture.archive, fixture.archiveBytes);
    const fetchImpl = vi.fn(() => {
      throw new Error("network request was not expected for a cache hit");
    });

    const result = await prepareLlamaRuntime({
      ...fixture.baseOptions,
      fetchImpl,
    });

    expect(result).toEqual({
      archive: fixture.archive,
      executable: fixture.executable,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fixture.spawnSyncImpl).toHaveBeenCalledOnce();
  });

  it("replaces a corrupt runtime archive only after verifying its partial download", async () => {
    const fixture = await makeRuntimeFixture();
    await writeFile(fixture.archive, "corrupt archive");
    await writeFile(fixture.temporary, "leftover partial");
    const fetchImpl = vi.fn(async () => new Response(fixture.archiveBytes));
    const renameFile = vi.fn(async (partial, destination) => {
      expect(partial).toBe(fixture.temporary);
      expect(await readFile(partial)).toEqual(fixture.archiveBytes);
      expect(sha256(await readFile(partial))).toBe(fixture.asset.sha256);
      expect(existsSync(destination)).toBe(false);
      await rename(partial, destination);
    });

    await prepareLlamaRuntime({
      ...fixture.baseOptions,
      fetchImpl,
      renameFile,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(renameFile).toHaveBeenCalledOnce();
    expect(await readFile(fixture.archive)).toEqual(fixture.archiveBytes);
    expect(existsSync(fixture.temporary)).toBe(false);
  });

  it("removes runtime partial files when a download is interrupted", async () => {
    const fixture = await makeRuntimeFixture();
    await writeFile(fixture.archive, "corrupt archive");
    await writeFile(fixture.temporary, "leftover partial");
    const fetchImpl = vi.fn(async () => responseWithInterruptedBody());

    await expect(
      prepareLlamaRuntime({ ...fixture.baseOptions, fetchImpl }),
    ).rejects.toThrow("fixture download interrupted");

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fixture.spawnSyncImpl).not.toHaveBeenCalled();
    expect(existsSync(fixture.archive)).toBe(false);
    expect(existsSync(fixture.temporary)).toBe(false);
  });
});

describe("downloadSmokeGguf fixture cache", () => {
  async function makeModelFixture() {
    const directory = await makeTemporaryDirectory();
    const output = path.join(directory, "model.gguf");
    const modelBytes = Buffer.from("GGUF verified test model fixture");
    const expectedSha256 = sha256(modelBytes);
    const temporary = `${output}.${process.pid}.partial`;
    const fetchImpl = vi.fn(async () => new Response(modelBytes));
    return {
      directory,
      expectedSha256,
      fetchImpl,
      modelBytes,
      output,
      temporary,
    };
  }

  it("uses a valid cached GGUF without a network request", async () => {
    const fixture = await makeModelFixture();
    await writeFile(fixture.output, fixture.modelBytes);
    const fetchImpl = vi.fn(() => {
      throw new Error("network request was not expected for a cache hit");
    });

    const result = await downloadSmokeGguf(fixture.output, {
      expectedSha256: fixture.expectedSha256,
      fetchImpl,
    });

    expect(result).toMatchObject({ status: "cached", output: fixture.output });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("replaces a corrupt GGUF only after verifying its partial download", async () => {
    const fixture = await makeModelFixture();
    await writeFile(fixture.output, "corrupt model");
    await writeFile(fixture.temporary, "leftover partial");
    const renameFile = vi.fn(async (partial, destination) => {
      expect(partial).toBe(fixture.temporary);
      expect(await readFile(partial)).toEqual(fixture.modelBytes);
      expect(sha256(await readFile(partial))).toBe(fixture.expectedSha256);
      expect(existsSync(destination)).toBe(false);
      await rename(partial, destination);
    });

    const result = await downloadSmokeGguf(fixture.output, {
      expectedSha256: fixture.expectedSha256,
      fetchImpl: fixture.fetchImpl,
      renameFile,
    });

    expect(result.status).toBe("downloaded");
    expect(fixture.fetchImpl).toHaveBeenCalledOnce();
    expect(renameFile).toHaveBeenCalledOnce();
    expect(await readFile(fixture.output)).toEqual(fixture.modelBytes);
    expect(existsSync(fixture.temporary)).toBe(false);
  });

  it("removes GGUF partial files when a download is interrupted", async () => {
    const fixture = await makeModelFixture();
    await writeFile(fixture.output, "corrupt model");
    await writeFile(fixture.temporary, "leftover partial");
    const fetchImpl = vi.fn(async () => responseWithInterruptedBody());

    await expect(
      downloadSmokeGguf(fixture.output, {
        expectedSha256: fixture.expectedSha256,
        fetchImpl,
      }),
    ).rejects.toThrow("fixture download interrupted");

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(existsSync(fixture.output)).toBe(false);
    expect(existsSync(fixture.temporary)).toBe(false);
  });
});
