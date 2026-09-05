import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  createReadStream,
  createWriteStream,
  type Stats,
} from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  statfs,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export const DEFAULT_MIN_GGUF_BYTES = 1024 * 1024;
export const DEFAULT_MAX_GGUF_BYTES = 256 * 1024 ** 3;

export interface GgufInspection {
  byteSize: number;
  ggufVersion: number;
}

export interface GgufImportInspection extends GgufInspection {
  freeSpaceBytes: number;
  requiredSpaceBytes: number;
}

export interface CustomGgufMetadata extends GgufInspection {
  /** A basename only, relative to the store root. */
  path: string;
  originalFilename: string;
  sha256: string;
  importedAt: string;
}

export interface GgufImportProgress {
  copiedBytes: number;
  totalBytes: number;
  fraction: number;
}

export type ManagedGgufMetadata = CustomGgufMetadata;
export type CustomGgufInspection = GgufInspection;
export type CustomGgufImportProgress = GgufImportProgress;

export interface CustomGgufStoreOptions {
  minBytes?: number;
  maxBytes?: number;
  /** Extra bytes which must remain free in addition to the model size. */
  freeSpaceHeadroomBytes?: number;
  /** Test seam; defaults to statfs(root). */
  getFreeSpaceBytes?: (root: string) => Promise<number>;
  progressThrottleMs?: number;
}

export interface GgufImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: GgufImportProgress) => void;
}

export interface VerifiedGgufForLaunch {
  path: string;
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

function abortError(): Error {
  const error = new Error("GGUF import was aborted");
  error.name = "AbortError";
  return error;
}

function assertSize(size: number, min: number, max: number): void {
  if (!Number.isSafeInteger(size) || size < min || size > max) {
    throw new RangeError(`GGUF size ${size} is outside allowed range ${min}..${max}`);
  }
}

function parseHeader(header: Buffer): number {
  if (header.length < 8 || header.toString("ascii", 0, 4) !== "GGUF") {
    throw new Error("Invalid GGUF signature");
  }
  const version = header.readUInt32LE(4);
  if (version < 1 || version > 3) {
    throw new Error(`Unsupported GGUF version ${version}`);
  }
  return version;
}

function assertBasename(relativePath: string): void {
  if (
    !relativePath ||
    relativePath.includes("\0") ||
    path.basename(relativePath) !== relativePath ||
    relativePath === "." ||
    relativePath === ".."
  ) {
    throw new Error("Managed GGUF path must be a basename");
  }
}

export class CustomGgufStore {
  private readonly minBytes: number;
  private readonly maxBytes: number;
  private readonly headroom: number;
  private readonly getFreeSpace: (root: string) => Promise<number>;
  private readonly throttleMs: number;

  constructor(
    readonly root: string,
    options: CustomGgufStoreOptions = {},
  ) {
    if (!path.isAbsolute(root)) {
      throw new TypeError("GGUF store root must be absolute");
    }
    this.minBytes = options.minBytes ?? DEFAULT_MIN_GGUF_BYTES;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_GGUF_BYTES;
    this.headroom = options.freeSpaceHeadroomBytes ?? 64 * 1024 * 1024;
    this.throttleMs = options.progressThrottleMs ?? 100;
    if (
      !Number.isSafeInteger(this.minBytes) ||
      !Number.isSafeInteger(this.maxBytes) ||
      this.minBytes < 0 ||
      this.maxBytes < this.minBytes ||
      !Number.isSafeInteger(this.headroom) ||
      this.headroom < 0
    ) {
      throw new RangeError("Invalid GGUF store size limits");
    }
    this.getFreeSpace =
      options.getFreeSpaceBytes ??
      (async (directory) => {
        const stats = await statfs(directory, { bigint: true });
        const free = stats.bavail * stats.bsize;
        if (free > BigInt(Number.MAX_SAFE_INTEGER)) return Number.MAX_SAFE_INTEGER;
        return Number(free);
      });
  }

  private async prepareRoot(): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const stats = await lstat(this.root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error("GGUF store root must be a real directory");
    }
    await chmod(this.root, 0o700);
    return realpath(this.root);
  }

  private async openSource(sourcePath: string) {
    if (
      !path.isAbsolute(sourcePath) ||
      sourcePath.includes("\0") ||
      path.extname(sourcePath).toLowerCase() !== ".gguf"
    ) {
      throw new TypeError("GGUF source must be an absolute .gguf path");
    }
    const before = await lstat(sourcePath);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("GGUF source must be a regular file, not a symlink");
    }
    await access(sourcePath, constants.R_OK);
    const noFollow = constants.O_NOFOLLOW ?? 0;
    const handle = await open(sourcePath, constants.O_RDONLY | noFollow);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || !sameFile(before, stats)) {
        throw new Error("GGUF source changed while being opened");
      }
      assertSize(stats.size, this.minBytes, this.maxBytes);
      const header = Buffer.alloc(8);
      const { bytesRead } = await handle.read(header, 0, 8, 0);
      if (bytesRead !== 8) throw new Error("Truncated GGUF header");
      return { handle, inspection: { byteSize: stats.size, ggufVersion: parseHeader(header) } };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  async inspect(sourcePath: string): Promise<GgufInspection> {
    const opened = await this.openSource(sourcePath);
    await opened.handle.close();
    return opened.inspection;
  }

  async inspectSource(sourcePath: string): Promise<GgufInspection> {
    return this.inspect(sourcePath);
  }

  async inspectForImport(sourcePath: string): Promise<GgufImportInspection> {
    const root = await this.prepareRoot();
    const opened = await this.openSource(sourcePath);
    try {
      const freeSpaceBytes = await this.getFreeSpace(root);
      const requiredSpaceBytes = opened.inspection.byteSize + this.headroom;
      if (
        !Number.isFinite(freeSpaceBytes) ||
        freeSpaceBytes < requiredSpaceBytes
      ) {
        throw new Error("Insufficient free space to import GGUF model");
      }
      return {
        ...opened.inspection,
        freeSpaceBytes,
        requiredSpaceBytes,
      };
    } finally {
      await opened.handle.close();
    }
  }

  async cleanStalePartials(): Promise<void> {
    const root = await this.prepareRoot();
    const entries = await readdir(root, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            (entry.isFile() || entry.isSymbolicLink()) &&
            entry.name.endsWith(".partial"),
        )
        .map((entry) => unlink(path.join(root, entry.name))),
    );
  }

  async import(
    sourcePath: string,
    options: GgufImportOptions = {},
  ): Promise<CustomGgufMetadata> {
    const root = await this.prepareRoot();
    const opened = await this.openSource(sourcePath);
    let partialPath: string | undefined;
    try {
      if (options.signal?.aborted) throw abortError();
      const free = await this.getFreeSpace(root);
      if (!Number.isFinite(free) || free < opened.inspection.byteSize + this.headroom) {
        throw new Error("Insufficient free space to import GGUF model");
      }

      partialPath = path.join(
        root,
        `${process.pid}-${randomUUID()}.partial`,
      );
      const hash = createHash("sha256");
      let copied = 0;
      let lastProgress = -Infinity;
      const progress = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          if (options.signal?.aborted) return callback(abortError());
          hash.update(chunk);
          copied += chunk.length;
          const now = Date.now();
          if (options.onProgress && now - lastProgress >= this.throttleMs) {
            lastProgress = now;
            options.onProgress({
              copiedBytes: copied,
              totalBytes: opened.inspection.byteSize,
              fraction: copied / opened.inspection.byteSize,
            });
          }
          callback(null, chunk);
        },
      });
      await pipeline(
        createReadStream("", { fd: opened.handle.fd, autoClose: false }),
        progress,
        createWriteStream(partialPath, { flags: "wx", mode: 0o600 }),
        { signal: options.signal },
      );
      if (copied !== opened.inspection.byteSize) {
        throw new Error("GGUF source size changed during import");
      }
      options.onProgress?.({
        copiedBytes: copied,
        totalBytes: copied,
        fraction: 1,
      });
      const sha256 = hash.digest("hex");
      const managedName = `${sha256}.gguf`;
      const destination = path.join(root, managedName);
      try {
        await rename(partialPath, destination);
      } catch (error) {
        const existing = await lstat(destination).catch(() => undefined);
        if (!existing?.isFile() || existing.isSymbolicLink()) throw error;
        const existingHash = createHash("sha256");
        let existingBytes = 0;
        for await (const chunk of createReadStream(destination)) {
          const bytes = chunk as Buffer;
          existingBytes += bytes.length;
          existingHash.update(bytes);
        }
        if (
          existingBytes !== copied ||
          existingHash.digest("hex") !== sha256
        ) {
          throw new Error("Conflicting managed GGUF fingerprint");
        }
        await unlink(partialPath);
      }
      partialPath = undefined;
      return {
        path: managedName,
        originalFilename: path.basename(sourcePath),
        byteSize: copied,
        sha256,
        ggufVersion: opened.inspection.ggufVersion,
        importedAt: new Date().toISOString(),
      };
    } finally {
      await opened.handle.close().catch(() => undefined);
      if (partialPath) await unlink(partialPath).catch(() => undefined);
    }
  }

  async importModel(
    sourcePath: string,
    options: GgufImportOptions = {},
  ): Promise<CustomGgufMetadata> {
    return this.import(sourcePath, options);
  }

  async resolve(metadata: Pick<CustomGgufMetadata, "path">): Promise<string> {
    assertBasename(metadata.path);
    const root = await this.prepareRoot();
    const resolved = path.resolve(root, metadata.path);
    if (path.dirname(resolved) !== root) throw new Error("Managed GGUF escapes store root");
    const stats = await lstat(resolved);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("Managed GGUF must be a regular file, not a symlink");
    }
    return resolved;
  }

  async verifyForLaunch(
    metadata: CustomGgufMetadata,
  ): Promise<VerifiedGgufForLaunch> {
    if (!/^[a-f0-9]{64}$/.test(metadata.sha256)) {
      throw new Error("Invalid managed GGUF SHA-256");
    }
    if (metadata.path !== `${metadata.sha256}.gguf`) {
      throw new Error("Managed GGUF path does not match fingerprint");
    }
    const managedPath = await this.resolve(metadata);
    const handle = await open(managedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== metadata.byteSize) {
        throw new Error("Managed GGUF size mismatch");
      }
      const hash = createHash("sha256");
      let first = Buffer.alloc(0);
      for await (const chunk of createReadStream("", {
        fd: handle.fd,
        autoClose: false,
      })) {
        const bytes = chunk as Buffer;
        if (first.length < 8) {
          first = Buffer.concat([first, bytes.subarray(0, 8 - first.length)]);
        }
        hash.update(bytes);
      }
      const version = parseHeader(first);
      if (version !== metadata.ggufVersion) throw new Error("Managed GGUF version mismatch");
      if (hash.digest("hex") !== metadata.sha256) {
        throw new Error("Managed GGUF SHA-256 mismatch");
      }
      const after = await handle.stat();
      if (!sameFile(before, after)) {
        throw new Error("Managed GGUF changed during verification");
      }
      return {
        path: managedPath,
        dev: after.dev,
        ino: after.ino,
        size: after.size,
        mtimeMs: after.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  }

  async assertLaunchIdentity(
    verified: VerifiedGgufForLaunch,
  ): Promise<void> {
    assertBasename(path.basename(verified.path));
    const root = await this.prepareRoot();
    if (path.dirname(path.resolve(verified.path)) !== root) {
      throw new Error("Verified GGUF escapes store root");
    }
    const before = await lstat(verified.path);
    if (!before.isFile() || before.isSymbolicLink()) {
      throw new Error("Managed GGUF changed before launch");
    }
    const handle = await open(
      verified.path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const current = await handle.stat();
      if (
        !current.isFile() ||
        current.dev !== verified.dev ||
        current.ino !== verified.ino ||
        current.size !== verified.size ||
        current.mtimeMs !== verified.mtimeMs ||
        !sameFile(before, current)
      ) {
        throw new Error("Managed GGUF changed before launch");
      }
    } finally {
      await handle.close();
    }
  }

  async verify(metadata: CustomGgufMetadata): Promise<string> {
    return (await this.verifyForLaunch(metadata)).path;
  }

  async verifyBeforeUse(metadata: CustomGgufMetadata): Promise<string> {
    return this.verify(metadata);
  }

  async remove(metadata: CustomGgufMetadata): Promise<void> {
    const managedPath = await this.verify(metadata);
    await unlink(managedPath);
  }

  async discard(metadata: Pick<CustomGgufMetadata, "path">): Promise<void> {
    const managedPath = await this.resolve(metadata);
    await unlink(managedPath);
  }
}

function sameFile(before: Stats, after: Stats): boolean {
  // ino/dev are reliable on POSIX. Size/mtime adds useful protection on Windows.
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs
  );
}