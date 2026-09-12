import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { resolveStoredDesktopDownload } = vi.hoisted(() => ({
  resolveStoredDesktopDownload: vi.fn(),
}));

vi.mock("../lib/download-storage", () => ({
  resolveStoredDesktopDownload,
}));

import downloadRouter from "./download";

let server: Server;
let base: string;
let downloadsDir: string;
let repoSequence = 0;

beforeAll(async () => {
  const app = express();
  app.use("/api", downloadRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

beforeEach(() => {
  downloadsDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "engram-route-downloads-"),
  );
  process.env["ANDROID_APK_DIR"] = downloadsDir;
  process.env["DOWNLOADS_GITHUB_REPO"] =
    `Tech953/route-download-test-${++repoSequence}`;
  resolveStoredDesktopDownload.mockReset();
});

afterEach(() => {
  delete process.env["ANDROID_APK_DIR"];
  delete process.env["DOWNLOADS_GITHUB_REPO"];
  fs.rmSync(downloadsDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("desktop download routes", () => {
  it("reports the storage-backed archive and redirects without downloading it", async () => {
    const filename = "ENGRAM-0.1.0-x64.zip";
    const signedUrl = "https://storage.example/signed/desktop.zip";
    resolveStoredDesktopDownload.mockResolvedValue({
      filename,
      sizeBytes: 2_671_959_069,
      url: signedUrl,
    });

    const metadataResponse = await fetch(`${base}/api/download/desktop`);
    expect(metadataResponse.status).toBe(200);
    expect(await metadataResponse.json()).toEqual({
      available: true,
      source: "storage",
      version: "0.1.0",
      publishedAt: null,
      installers: [
        {
          os: "win",
          ext: ".zip",
          filename,
          sizeBytes: 2_671_959_069,
          downloadPath: `/api/download/desktop/file/${filename}`,
        },
      ],
    });

    const fileResponse = await fetch(
      `${base}/api/download/desktop/file/${filename}`,
      { redirect: "manual" },
    );
    expect(fileResponse.status).toBe(302);
    expect(fileResponse.headers.get("location")).toBe(signedUrl);
    expect(fs.readdirSync(downloadsDir)).toEqual([]);
    expect(resolveStoredDesktopDownload).toHaveBeenCalled();
  });

  it("falls back to the GitHub release tier when storage is unavailable", async () => {
    const filename = "ENGRAM-1.0.26-x64.zip";
    resolveStoredDesktopDownload.mockResolvedValue(null);

    const nativeFetch = globalThis.fetch;
    const githubFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url =
          input instanceof Request
            ? input.url
            : input instanceof URL
              ? input.href
              : String(input);
        if (url.startsWith(base)) return nativeFetch(input, init);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              tag_name: "v1.0.26",
              published_at: "2026-09-12T12:00:00Z",
              assets: [
                {
                  name: filename,
                  browser_download_url:
                    "https://github.com/Tech953/Ch-IO/releases/download/v1.0.26/ENGRAM-1.0.26-x64.zip",
                  size: 2_671_959_069,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });

    const response = await nativeFetch(`${base}/api/download/desktop`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: true,
      source: "github",
      version: "1.0.26",
      publishedAt: "2026-09-12T12:00:00Z",
      installers: [
        {
          os: "win",
          ext: ".zip",
          filename,
          sizeBytes: 2_671_959_069,
          downloadPath: `/api/download/desktop/file/${filename}`,
        },
      ],
    });
    expect(
      githubFetch.mock.calls.some(([input]) =>
        String(input).includes("/releases/latest"),
      ),
    ).toBe(true);
    expect(fs.readdirSync(downloadsDir)).toEqual([]);
  });
});
