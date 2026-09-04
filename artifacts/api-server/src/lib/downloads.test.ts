import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { resolveStoredDesktopDownload } = vi.hoisted(() => ({
  resolveStoredDesktopDownload: vi.fn(),
}));

vi.mock("./download-storage", () => ({
  resolveStoredDesktopDownload,
}));

import { findDesktopInstaller, resolveDesktop } from "./downloads";

describe("desktop download resolution", () => {
  let downloadsDir: string;

  beforeEach(() => {
    downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-downloads-"));
    process.env["ANDROID_APK_DIR"] = downloadsDir;
    resolveStoredDesktopDownload.mockReset();
  });

  afterEach(() => {
    delete process.env["ANDROID_APK_DIR"];
    fs.rmSync(downloadsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prefers a bundled installer over App Storage", async () => {
    const filename = "ENGRAM-1.2.3-x64.zip";
    fs.writeFileSync(path.join(downloadsDir, filename), "bundled");
    resolveStoredDesktopDownload.mockResolvedValue({
      filename,
      sizeBytes: 99,
      url: "https://storage.example/signed",
    });

    const resolved = await resolveDesktop();

    expect(resolved.source).toBe("bundled");
    expect(resolved.version).toBe("1.2.3");
    expect(resolved.installers[0]).toMatchObject({
      filename,
      source: "bundled",
    });
    expect(resolveStoredDesktopDownload).not.toHaveBeenCalled();
  });

  it("uses App Storage before the GitHub fallback", async () => {
    resolveStoredDesktopDownload.mockResolvedValue({
      filename: "ENGRAM-0.1.0-x64.zip",
      sizeBytes: 2_671_959_069,
      url: "https://storage.example/signed",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const resolved = await resolveDesktop();
    const installer = await findDesktopInstaller("ENGRAM-0.1.0-x64.zip");

    expect(resolved).toMatchObject({
      source: "storage",
      version: "0.1.0",
      installers: [
        {
          os: "win",
          ext: ".zip",
          source: "storage",
          sizeBytes: 2_671_959_069,
        },
      ],
    });
    expect(installer).toMatchObject({
      source: "storage",
      url: "https://storage.example/signed",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});