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

import {
  downloadsRepo,
  findDesktopInstaller,
  githubReleasesUrl,
  resolveBundledApk,
  resolveDesktop,
} from "./downloads";

describe("desktop download resolution", () => {
  let downloadsDir: string;

  beforeEach(() => {
    downloadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "engram-downloads-"));
    process.env["ANDROID_APK_DIR"] = downloadsDir;
    resolveStoredDesktopDownload.mockReset();
  });

  afterEach(() => {
    delete process.env["ANDROID_APK_DIR"];
    delete process.env["VITE_GITHUB_REPO"];
    delete process.env["DOWNLOADS_GITHUB_REPO"];
    delete process.env["ANDROID_APK_PATH"];
    fs.rmSync(downloadsDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("uses the shared web/API repository setting for release fallbacks", () => {
    process.env["VITE_GITHUB_REPO"] = "Example/engram-releases";
    process.env["DOWNLOADS_GITHUB_REPO"] = "Legacy/api-only-releases";

    expect(downloadsRepo()).toBe("Example/engram-releases");
    expect(githubReleasesUrl()).toBe(
      "https://github.com/Example/engram-releases/releases/latest",
    );
  });

  it("prefers a bundled installer over App Storage", async () => {
    const filename = "ENGRAM-1.2.3-x64.zip";
    fs.writeFileSync(path.join(downloadsDir, filename), "bundled");
    resolveStoredDesktopDownload.mockResolvedValue({
      filename,
      sizeBytes: 99,
      url: "https://storage.example/signed",
      publishedAt: null,
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
      publishedAt: "2026-09-09T12:00:00.000Z",
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const resolved = await resolveDesktop();
    const installer = await findDesktopInstaller("ENGRAM-0.1.0-x64.zip");

    expect(resolved).toMatchObject({
      source: "storage",
      version: "0.1.0",
      publishedAt: "2026-09-09T12:00:00.000Z",
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

  it("uses the newest bundled file timestamp as the release date", async () => {
    const filename = "ENGRAM-1.2.3-x64.zip";
    const filePath = path.join(downloadsDir, filename);
    fs.writeFileSync(filePath, "bundled");
    fs.utimesSync(
      filePath,
      new Date("2026-09-08T12:00:00Z"),
      new Date("2026-09-10T12:00:00Z"),
    );
    resolveStoredDesktopDownload.mockResolvedValue({
      filename,
      sizeBytes: 99,
      url: "https://storage.example/signed",
      publishedAt: "2026-09-01T12:00:00.000Z",
    });

    const resolved = await resolveDesktop();

    expect(resolved.source).toBe("bundled");
    expect(resolved.publishedAt).toBe("2026-09-10T12:00:00.000Z");
    expect(resolved.installers[0]?.publishedAt).toBe(
      "2026-09-10T12:00:00.000Z",
    );
    expect(resolveStoredDesktopDownload).not.toHaveBeenCalled();
  });

  it("reports the bundled APK timestamp when it is available", () => {
    const apkPath = path.join(downloadsDir, "ENGRAM-android-1.2.3.apk");
    fs.writeFileSync(apkPath, "bundled apk");
    fs.utimesSync(
      apkPath,
      new Date("2026-09-08T12:00:00Z"),
      new Date("2026-09-10T12:00:00Z"),
    );
    process.env["ANDROID_APK_PATH"] = apkPath;

    expect(resolveBundledApk()).toMatchObject({
      kind: "bundled",
      version: "1.2.3",
      publishedAt: "2026-09-10T12:00:00.000Z",
    });
  });

  it("returns the latest release date and matching installer assets", async () => {
    resolveStoredDesktopDownload.mockResolvedValue(null);
    process.env["DOWNLOADS_GITHUB_REPO"] = "Tech953/Ch-IO";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        tag_name: "v1.0.24",
        published_at: "2026-09-10T12:00:00Z",
        assets: [
          {
            name: "ENGRAM-1.0.24-arm64.dmg",
            browser_download_url:
              "https://github.com/Tech953/Ch-IO/releases/download/v1.0.24/ENGRAM-1.0.24-arm64.dmg",
            size: 100,
          },
          {
            name: "ENGRAM-1.0.24-x64.AppImage",
            browser_download_url:
              "https://github.com/Tech953/Ch-IO/releases/download/v1.0.24/ENGRAM-1.0.24-x64.AppImage",
            size: 200,
          },
        ],
      }),
    } as Response);

    const resolved = await resolveDesktop();

    expect(resolved).toMatchObject({
      source: "github",
      version: "1.0.24",
      publishedAt: "2026-09-10T12:00:00Z",
    });
    expect(resolved.installers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          os: "mac",
          filename: "ENGRAM-1.0.24-arm64.dmg",
          url: "https://github.com/Tech953/Ch-IO/releases/download/v1.0.24/ENGRAM-1.0.24-arm64.dmg",
        }),
        expect.objectContaining({
          os: "linux",
          filename: "ENGRAM-1.0.24-x64.AppImage",
          url: "https://github.com/Tech953/Ch-IO/releases/download/v1.0.24/ENGRAM-1.0.24-x64.AppImage",
        }),
      ]),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/Tech953/Ch-IO/releases/latest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "application/vnd.github+json",
        }),
      }),
    );
  });
});
