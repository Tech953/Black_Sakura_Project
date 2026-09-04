import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const storage = new Map<string, string>();
  const state = {
    modelExists: false,
    partBytes: 0,
    freshDownload: undefined as (() => Promise<{ status: number }>) | undefined,
    resumeDownload: undefined as (() => Promise<{ status: number }>) | undefined,
    pause: vi.fn(async () => {}),
    savable: vi.fn(() => ({ resumeData: "resume-token" })),
    move: vi.fn(async () => {
      state.modelExists = true;
      state.partBytes = 0;
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
    if (path.endsWith(".part")) {
      return { exists: mocks.state.partBytes > 0, size: mocks.state.partBytes };
    }
    return { exists: mocks.state.modelExists, size: mocks.state.modelExists ? 1 : 0 };
  }),
  deleteAsync: vi.fn(async () => {
    mocks.state.partBytes = 0;
    mocks.state.modelExists = false;
  }),
  moveAsync: mocks.state.move,
}));

import {
  MODEL_BYTES,
  cancelDownload,
  downloadModel,
} from "./model";

describe("offline model download failure harness", () => {
  beforeEach(() => {
    mocks.storage.clear();
    mocks.state.modelExists = false;
    mocks.state.partBytes = 0;
    mocks.state.freshDownload = undefined;
    mocks.state.resumeDownload = undefined;
    mocks.state.pause.mockClear();
    mocks.state.savable.mockClear();
    mocks.state.move.mockClear();
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
});