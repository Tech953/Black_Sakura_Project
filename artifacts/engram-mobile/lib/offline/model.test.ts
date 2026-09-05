import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const state = {
    modelExists: false,
    customExists: false,
    customBytes: 0,
    customPartBytes: 0,
    customBackupExists: false,
    sourceExists: true,
    sourceBytes: 2_000_000,
    headerBase64: "R0dVRgMAAAA=",
    copyGate: undefined as Promise<void> | undefined,
    partBytes: 0,
    freshDownload: undefined as (() => Promise<{ status: number }>) | undefined,
    resumeDownload: undefined as (() => Promise<{ status: number }>) | undefined,
    pause: vi.fn(async () => {}),
    savable: vi.fn(() => ({ resumeData: "resume-token" })),
    move: vi.fn(async ({ from, to }: { from: string; to: string }) => {
      if (to.endsWith("custom-model.gguf.part")) {
        state.customPartBytes = state.sourceBytes;
      } else if (to.endsWith("custom-model.gguf.previous")) {
        state.customBackupExists = state.customExists;
        state.customExists = false;
        state.customBytes = 0;
      } else if (to.endsWith("custom-model.gguf")) {
        if (from.endsWith("custom-model.gguf.part")) {
          state.customExists = true;
          state.customBytes = state.customPartBytes;
          state.customPartBytes = 0;
        } else if (from.endsWith("custom-model.gguf.previous")) {
          state.customExists = state.customBackupExists;
          state.customBytes = state.sourceBytes;
          state.customBackupExists = false;
        }
      } else {
        state.modelExists = true;
        state.partBytes = 0;
      }
    }),
    copy: vi.fn(async () => {
      if (state.copyGate) await state.copyGate;
      state.customPartBytes = state.sourceBytes;
    }),
  };

  class FakeDownloadResumable {
    constructor(
      readonly url: string,
      readonly path: string,
      readonly options: object,
      readonly progress: (progress: {
        totalBytesWritten: number;
        totalBytesExpectedToWrite: number;
      }) => void,
      readonly resumeData?: string,
    ) {}

    downloadAsync() {
      return state.freshDownload?.() ?? Promise.resolve({ status: 200 });
    }

    resumeAsync() {
      return state.resumeDownload?.() ?? Promise.resolve({ status: 206 });
    }

    pauseAsync() {
      return state.pause();
    }

    savable() {
      return state.savable();
    }
  }

  return { storage, state, FakeDownloadResumable };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => mocks.storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      mocks.storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      mocks.storage.delete(key);
    }),
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  EncodingType: { Base64: "base64" },
  DownloadResumable: mocks.FakeDownloadResumable,
  createDownloadResumable: vi.fn(() => new mocks.FakeDownloadResumable(
      "https://model.test",
      "file:///documents/models/model.part",
      {},
      () => {},
    )),
  makeDirectoryAsync: vi.fn(async () => {
  }),
  getFreeDiskStorageAsync: vi.fn(async () => {
    return 2_000_000_000;
  }),
  getInfoAsync: vi.fn(async (path: string) => {
    if (path.endsWith("custom-model.gguf.previous")) {
      return { exists: mocks.state.customBackupExists, size: mocks.state.customBytes };
    }
    if (path.endsWith("custom-model.gguf.part")) {
      return { exists: mocks.state.customPartBytes > 0, size: mocks.state.customPartBytes };
    }
    if (path.endsWith("custom-model.gguf")) {
      return { exists: mocks.state.customExists, size: mocks.state.customBytes };
    }
    if (path.includes("picked-model.gguf")) {
      return { exists: mocks.state.sourceExists, size: mocks.state.sourceBytes };
    }
    if (path.endsWith(".part")) {
      return { exists: mocks.state.partBytes > 0, size: mocks.state.partBytes };
    }
    return { exists: mocks.state.modelExists, size: mocks.state.modelExists ? 1 : 0 };
  }),
  deleteAsync: vi.fn(async (path: string) => {
    if (path.endsWith("custom-model.gguf.part")) {
      mocks.state.customPartBytes = 0;
    } else if (path.endsWith("custom-model.gguf.previous")) {
      mocks.state.customBackupExists = false;
    } else if (path.endsWith("custom-model.gguf")) {
      mocks.state.customExists = false;
      mocks.state.customBytes = 0;
    } else {
      mocks.state.partBytes = 0;
      mocks.state.modelExists = false;
    }
  }),
  moveAsync: mocks.state.move,
  copyAsync: mocks.state.copy,
  readAsStringAsync: vi.fn(async () => mocks.state.headerBase64),
}));

import {
  CUSTOM_MODEL_PATH,
  MODEL_BYTES,
  cancelDownload,
  cancelCustomModelImport,
  downloadModel,
  getModelStatus,
  importCustomModel,
} from "./model";

describe("offline model download failure harness", () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.state.modelExists = false;
    mocks.state.customExists = false;
    mocks.state.customBytes = 0;
    mocks.state.customPartBytes = 0;
    mocks.state.customBackupExists = false;
    mocks.state.sourceExists = true;
    mocks.state.sourceBytes = 2_000_000;
    mocks.state.headerBase64 = "R0dVRgMAAAA=";
    mocks.state.copyGate = undefined;
    mocks.state.partBytes = 0;
    mocks.state.freshDownload = undefined;
    mocks.state.resumeDownload = undefined;
    mocks.state.pause.mockClear();
    mocks.state.savable.mockClear();
    mocks.state.move.mockClear();
    mocks.state.copy.mockClear();
  });

  it("shares concurrent download requests instead of starting two native downloads", async () => {
    let finish!: () => void;
    const fresh = new Promise<{ status: number }>((resolve) => {
      finish = () => {
        mocks.state.partBytes = MODEL_BYTES;
        resolve({ status: 200 });
      };
    });
    const freshDownload = vi.fn(() => fresh);
    mocks.state.freshDownload = freshDownload;

    const first = downloadModel(vi.fn());
    const second = downloadModel(vi.fn());
    expect(first).toBe(second);

    await vi.waitFor(() => expect(freshDownload).toHaveBeenCalled());
    finish();
    await first;
  });

  it("persists resume data after interruption and resumes with HTTP 206", async () => {
    let interrupt!: (error: Error) => void;
    mocks.state.partBytes = 4096;
    const freshDownload = vi.fn(() =>
      new Promise((_, reject) => {
        mocks.state.partBytes = 4096;
        interrupt = reject;
      }),
    );
    mocks.state.freshDownload = freshDownload;
    const first = downloadModel(vi.fn()).catch((error) => error);

    await vi.waitFor(() => expect(freshDownload).toHaveBeenCalled());
    await cancelDownload();
    expect(mocks.storage.get("engram.modelDownload.resumeData")).toBe(
      "resume-token",
    );

    interrupt(new Error("connection interrupted"));
    await expect(first).resolves.toMatchObject({ message: "connection interrupted" });

    mocks.state.resumeDownload = () => {
      mocks.state.partBytes = MODEL_BYTES;
      return Promise.resolve({ status: 206 });
    };
    const resumed = downloadModel(vi.fn());
    await resumed;

    expect(mocks.storage.has("engram.modelDownload.resumeData")).toBe(false);
    expect(mocks.state.move).toHaveBeenCalledTimes(1);
  });

  it("rejects incomplete native downloads and clears the untrusted partial file", async () => {
    mocks.state.freshDownload = () => {
      mocks.state.partBytes = 1234;
      return Promise.resolve({ status: 200 });
    };

    await expect(downloadModel(vi.fn())).rejects.toThrow("incomplete");
    expect(mocks.state.partBytes).toBe(0);
  });

  it("imports a valid GGUF into app-private storage and reports it as active", async () => {
    const progress: number[] = [];

    await importCustomModel(
      "file:///picked-model.gguf",
      "my-model.gguf",
      mocks.state.sourceBytes,
      (fraction) => progress.push(fraction),
    );

    expect(mocks.state.copy).toHaveBeenCalledTimes(1);
    expect(progress).toEqual([0, 0.75, 1]);
    await expect(getModelStatus()).resolves.toMatchObject({
      state: "ready",
      source: "custom",
      filename: "my-model.gguf",
      bytes: mocks.state.sourceBytes,
    });
    expect(CUSTOM_MODEL_PATH).toContain("/models/custom-model.gguf");
  });

  it("rejects a non-GGUF file before copying it", async () => {
    await expect(
      importCustomModel(
        "file:///picked-model.gguf",
        "not-a-model.bin",
        mocks.state.sourceBytes,
      ),
    ).rejects.toThrow(".gguf");
    expect(mocks.state.copy).not.toHaveBeenCalled();
  });

  it("restores the previous custom model when activation validation fails", async () => {
    mocks.state.customExists = true;
    mocks.state.customBytes = mocks.state.sourceBytes;
    mocks.storage.set(
      "engram.customModel.metadata",
      JSON.stringify({
        filename: "previous.gguf",
        byteSize: mocks.state.sourceBytes,
        ggufVersion: 3,
        importedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await expect(
      importCustomModel(
        "file:///picked-model.gguf",
        "replacement.gguf",
        mocks.state.sourceBytes,
        undefined,
        async () => {
          throw new Error("native model load failed");
        },
      ),
    ).rejects.toThrow("native model load failed");

    await expect(getModelStatus()).resolves.toMatchObject({
      state: "ready",
      source: "custom",
      filename: "previous.gguf",
    });
  });

  it("abandons a copy on cancellation and preserves the previous model", async () => {
    let finishCopy!: () => void;
    mocks.state.customExists = true;
    mocks.state.customBytes = mocks.state.sourceBytes;
    mocks.storage.set(
      "engram.customModel.metadata",
      JSON.stringify({
        filename: "previous.gguf",
        byteSize: mocks.state.sourceBytes,
        ggufVersion: 3,
        importedAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    mocks.state.copyGate = new Promise<void>((resolve) => {
      finishCopy = resolve;
    });

    const pending = importCustomModel(
      "file:///picked-model.gguf",
      "replacement.gguf",
      mocks.state.sourceBytes,
    );
    await vi.waitFor(() => expect(mocks.state.copy).toHaveBeenCalled());
    expect(cancelCustomModelImport()).toBe(true);
    finishCopy();

    await expect(pending).rejects.toMatchObject({
      code: "MODEL_IMPORT_CANCELLED",
    });
    expect(mocks.state.customPartBytes).toBe(0);
    await expect(getModelStatus()).resolves.toMatchObject({
      state: "ready",
      source: "custom",
      filename: "previous.gguf",
    });
    expect(cancelCustomModelImport()).toBe(false);
  });
});