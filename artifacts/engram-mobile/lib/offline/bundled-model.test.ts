import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import spec from "./bundled-model-spec.json";

const state = vi.hoisted(() => ({
  manifest: "",
  current: null as { exists: true; size: number; md5: string; isDirectory: false } | null,
  temporary: null as { exists: true; size: number; md5: string; isDirectory: false } | null,
  free: 2_000_000_000 as number | null,
  corruptCopy: false,
  copyError: false,
  copy: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
}));

vi.mock("expo-file-system/legacy", () => ({
  readAsStringAsync: vi.fn(async () => state.manifest),
  getInfoAsync: vi.fn(async (file: string) =>
    (file.endsWith(".installing") ? state.temporary : state.current) ?? { exists: false }),
  makeDirectoryAsync: vi.fn(async () => {}),
  getFreeDiskStorageAsync: vi.fn(async () => {
    if (state.free === null) throw new Error("No storage probe");
    return state.free;
  }),
  copyAsync: vi.fn(async (options: unknown) => {
    state.copy(options);
    if (state.copyError) throw new Error("Copy failed");
    state.temporary = {
      exists: true, isDirectory: false, size: 1107409472,
      md5: state.corruptCopy ? "00000000000000000000000000000000" : "11111111111111111111111111111111",
    };
  }),
  deleteAsync: vi.fn(async (file: string) => {
    state.remove(file);
    if (file.endsWith(".installing")) state.temporary = null;
    else state.current = null;
  }),
  moveAsync: vi.fn(async () => {
    state.current = state.temporary;
    state.temporary = null;
  }),
  createDownloadResumable: state.download,
}));

const target = `file:///private/models/${spec.filename}`;

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("EXPO_PUBLIC_BUNDLED_CHAT_MODEL", "1");
  state.manifest = JSON.stringify({ ...spec, format: 1, md5: "11111111111111111111111111111111" });
  state.current = null;
  state.temporary = null;
  state.free = 2_000_000_000;
  state.corruptCopy = false;
  state.copyError = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("APK chat-model extraction", () => {
  it("leaves ordinary builds unchanged", async () => {
    vi.stubEnv("EXPO_PUBLIC_BUNDLED_CHAT_MODEL", "");
    const { installPackagedChatModel } = await import("./bundled-model");
    await installPackagedChatModel(target);
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("installs from the APK, verifies, and reuses the private model without downloading", async () => {
    const { installPackagedChatModel } = await import("./bundled-model");
    await Promise.all([installPackagedChatModel(target), installPackagedChatModel(target)]);
    await installPackagedChatModel(target);
    expect(state.copy).toHaveBeenCalledExactlyOnceWith({
      from: `asset:///offline-model/${spec.filename}`, to: `${target}.installing`,
    });
    expect(state.current?.size).toBe(spec.bytes);
    expect(state.temporary).toBeNull();
    expect(state.download).not.toHaveBeenCalled();
  });

  it("reuses a previously installed verified model", async () => {
    state.current = { exists: true, isDirectory: false, size: spec.bytes, md5: "11111111111111111111111111111111" };
    const { installPackagedChatModel } = await import("./bundled-model");
    await installPackagedChatModel(target);
    expect(state.copy).not.toHaveBeenCalled();
  });

  it("rejects a different model manifest without a download fallback", async () => {
    state.manifest = state.manifest.replace(spec.sha256, "bad");
    const { installPackagedChatModel } = await import("./bundled-model");
    await expect(installPackagedChatModel(target)).rejects.toThrow("manifest is invalid");
    expect(state.copy).not.toHaveBeenCalled();
    expect(state.download).not.toHaveBeenCalled();
  });

  it.each([0, null])("fails closed when free storage is %s", async (free) => {
    state.free = free;
    const { installPackagedChatModel } = await import("./bundled-model");
    await expect(installPackagedChatModel(target)).rejects.toThrow("verified free storage");
    expect(state.copy).not.toHaveBeenCalled();
  });

  it("preserves the previous file if the replacement fails verification", async () => {
    const previous = { exists: true as const, isDirectory: false as const, size: spec.bytes, md5: "previous-corrupt-file" };
    state.current = previous;
    state.corruptCopy = true;
    const { installPackagedChatModel } = await import("./bundled-model");
    await expect(installPackagedChatModel(target)).rejects.toThrow("integrity check");
    expect(state.current).toBe(previous);
    expect(state.remove).not.toHaveBeenCalledWith(target);
    expect(state.temporary).toBeNull();
  });

  it("cleans failed copies and permits a local retry", async () => {
    state.copyError = true;
    const { installPackagedChatModel } = await import("./bundled-model");
    await expect(installPackagedChatModel(target)).rejects.toThrow("Copy failed");
    expect(state.temporary).toBeNull();
    state.copyError = false;
    await installPackagedChatModel(target);
    expect(state.current?.size).toBe(spec.bytes);
    expect(state.download).not.toHaveBeenCalled();
  });
});
