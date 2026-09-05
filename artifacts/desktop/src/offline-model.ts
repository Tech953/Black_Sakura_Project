import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  statSync,
} from "node:fs";
import {
  mkdir,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { URL } from "node:url";

/**
 * This is the exact model staged into full desktop builds. The slim Windows
 * build downloads the same immutable artifact into userData instead of putting
 * it inside the installed app bundle.
 */
export const OFFLINE_MODEL = {
  filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
  url:
    "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Instruct-2507-Q4_K_M.gguf?download=true",
  expectedBytes: 2_497_281_120,
  sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
} as const;

/**
 * Packaged smoke tests may substitute a tiny local fixture so the complete
 * post-install flow is tested without downloading the release model. The
 * override is opt-in and unavailable to normal users.
 */
export function offlineModelSpec(): OfflineModelSpec {
  if (process.env.ENGRAM_PACKAGED_OFFLINE_MODEL_FIXTURE !== "1") {
    return OFFLINE_MODEL;
  }
  const url = process.env.ENGRAM_PACKAGED_OFFLINE_MODEL_URL;
  const expectedBytes = Number(process.env.ENGRAM_PACKAGED_OFFLINE_MODEL_BYTES);
  const sha256 = process.env.ENGRAM_PACKAGED_OFFLINE_MODEL_SHA256;
  if (
    !url ||
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes <= 0 ||
    !sha256 ||
    !/^[a-f0-9]{64}$/.test(sha256)
  ) {
    throw new Error("Packaged offline-model fixture configuration is invalid.");
  }
  return {
    ...OFFLINE_MODEL,
    url,
    expectedBytes,
    sha256,
  };
}

export interface OfflineModelSpec {
  filename: string;
  url: string;
  expectedBytes: number;
  sha256: string;
}

export interface OfflineModelProgress {
  downloadedBytes: number;
  totalBytes: number;
  fraction: number;
}

export interface VerifiedOfflineModel {
  path: string;
  size: number;
  sha256: string;
}

export function offlineModelPath(
  root: string,
  spec: Pick<OfflineModelSpec, "filename"> = OFFLINE_MODEL,
): string {
  return path.join(root, spec.filename);
}

export function offlineModelPartialPath(
  root: string,
  spec: Pick<OfflineModelSpec, "filename"> = OFFLINE_MODEL,
): string {
  return `${offlineModelPath(root, spec)}.partial`;
}

function abortError(): Error {
  const error = new Error("Offline model download was cancelled");
  error.name = "AbortError";
  return error;
}

function modelPaths(root: string, spec: OfflineModelSpec) {
  return {
    final: offlineModelPath(root, spec),
    partial: `${offlineModelPath(root, spec)}.partial`,
  };
}

export function hasOfflineModelSync(
  root: string,
  spec: OfflineModelSpec = OFFLINE_MODEL,
): boolean {
  const { final } = modelPaths(root, spec);
  try {
    return existsSync(final) && statSync(final).isFile() && statSync(final).size === spec.expectedBytes;
  } catch {
    return false;
  }
}

async function hashAndVerify(
  filePath: string,
  spec: OfflineModelSpec,
): Promise<VerifiedOfflineModel> {
  const before = await stat(filePath);
  if (!before.isFile() || before.size !== spec.expectedBytes) {
    throw new Error(
      `Offline model size mismatch (expected ${spec.expectedBytes} bytes).`,
    );
  }

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  const sha256 = hash.digest("hex");
  if (sha256 !== spec.sha256) {
    throw new Error("Offline model SHA-256 mismatch.");
  }
  const after = await stat(filePath);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new Error("Offline model changed during verification.");
  }
  return { path: filePath, size: after.size, sha256 };
}

export async function verifyOfflineModel(
  root: string,
  spec: OfflineModelSpec = OFFLINE_MODEL,
): Promise<VerifiedOfflineModel> {
  return hashAndVerify(modelPaths(root, spec).final, spec);
}

function requestDownload(
  url: string,
  partialPath: string,
  offset: number,
  expectedBytes: number,
  signal: AbortSignal | undefined,
  onProgress: ((progress: OfflineModelProgress) => void) | undefined,
  redirectCount = 0,
): Promise<number> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects while downloading offline model."));
  }

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === "https:" ? https : http;
    const request = client.get(
      parsed,
      {
        headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(status)) {
          response.resume();
          void requestDownload(
            new URL(location, parsed).toString(),
            partialPath,
            offset,
            expectedBytes,
            signal,
            onProgress,
            redirectCount + 1,
          ).then(resolve, reject);
          return;
        }

        const append = offset > 0 && status === 206;
        if (status !== 200 && status !== 206) {
          response.resume();
          reject(new Error(`Offline model download returned HTTP ${status}.`));
          return;
        }

        const startingBytes = append ? offset : 0;
        let received = startingBytes;
        const output = createWriteStream(partialPath, {
          flags: append ? "a" : "w",
          mode: 0o600,
        });
        let settled = false;
        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          response.destroy();
          output.destroy();
          reject(error);
        };

        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          request.destroy(abortError());
          response.destroy(abortError());
          signal?.removeEventListener("abort", onAbort);
          output.end(() => reject(abortError()));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > expectedBytes) {
            fail(new Error("Offline model download exceeded the pinned size."));
            return;
          }
          if (!output.write(chunk)) {
            response.pause();
            output.once("drain", () => response.resume());
          }
          onProgress?.({
            downloadedBytes: received,
            totalBytes: expectedBytes,
            fraction: received / expectedBytes,
          });
        });
        response.on("end", () => output.end());
        response.on("error", fail);
        output.on("error", fail);
        output.on("finish", () => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          resolve(received);
        });
      },
    );
    request.on("error", (error) => {
      if (signal?.aborted) reject(abortError());
      else reject(error);
    });
  });
}

export async function downloadOfflineModel(
  root: string,
  options: {
    spec?: OfflineModelSpec;
    signal?: AbortSignal;
    onProgress?: (progress: OfflineModelProgress) => void;
  } = {},
): Promise<VerifiedOfflineModel> {
  const spec = options.spec ?? OFFLINE_MODEL;
  const { final, partial } = modelPaths(root, spec);
  await mkdir(root, { recursive: true });

  try {
    return await hashAndVerify(final, spec);
  } catch {
    // A failed final verification is never launched. Start a fresh download
    // rather than appending to a corrupt completed file.
    try {
      await unlink(final);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(
          "The existing offline model is invalid and cannot be replaced while it is in use.",
        );
      }
    }
  }

  let offset = 0;
  try {
    const partialStats = await stat(partial);
    if (partialStats.isFile() && partialStats.size <= spec.expectedBytes) {
      offset = partialStats.size;
      if (offset === spec.expectedBytes) {
        try {
          const verified = await hashAndVerify(partial, spec);
          await rename(partial, final);
          return { ...verified, path: final };
        } catch {
          await unlink(partial).catch(() => undefined);
          offset = 0;
        }
      }
    } else {
      await unlink(partial).catch(() => undefined);
    }
  } catch {
    // No resumable partial exists.
  }

  options.onProgress?.({
    downloadedBytes: offset,
    totalBytes: spec.expectedBytes,
    fraction: offset / spec.expectedBytes,
  });
  const received = await requestDownload(
    spec.url,
    partial,
    offset,
    spec.expectedBytes,
    options.signal,
    options.onProgress,
  );
  if (received !== spec.expectedBytes) {
    throw new Error(
      `Offline model download ended at ${received} bytes; expected ${spec.expectedBytes}.`,
    );
  }

  const verified = await hashAndVerify(partial, spec).catch(async (error) => {
    await unlink(partial).catch(() => undefined);
    throw error;
  });
  await rename(partial, final);
  return { ...verified, path: final };
}

export async function removeOfflineModel(
  root: string,
  spec: OfflineModelSpec = OFFLINE_MODEL,
): Promise<void> {
  const { final, partial } = modelPaths(root, spec);
  await unlink(final).catch(() => undefined);
  await unlink(partial).catch(() => undefined);
}

export function offlineModelStorageLocation(root: string): string {
  return root;
}