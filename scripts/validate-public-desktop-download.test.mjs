import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePublicApiUrl,
  validatePublicDesktopDownload,
} from "./validate-public-desktop-download.mjs";

function metadataResponse(overrides = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      available: true,
      source: "storage",
      installers: [
        {
          os: "win",
          ext: ".zip",
          filename: "ENGRAM-0.1.0-x64.zip",
          sizeBytes: 2_671_959_069,
          downloadPath: "/api/download/desktop/file/ENGRAM-0.1.0-x64.zip",
        },
      ],
      ...overrides,
    }),
  };
}

test("requires a credential-free HTTPS published URL", () => {
  for (const value of [
    "",
    "not a url",
    "http://example.test",
    "https://user:pass@example.test",
  ]) {
    assert.throws(() => resolvePublicApiUrl({ ENGRAM_PUBLIC_API_URL: value }));
  }
  assert.equal(
    resolvePublicApiUrl({
      ENGRAM_PUBLIC_API_URL: "https://example.replit.app/",
    }).href,
    "https://example.replit.app/",
  );
});
test("validates storage metadata and stops at the HTTPS redirect", async () => {
  const requests = [];
  let redirectBodyRead = false;
  const result = await validatePublicDesktopDownload({
    env: { ENGRAM_PUBLIC_API_URL: "https://example.replit.app" },
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      if (requests.length === 1) return metadataResponse();
      return {
        status: 302,
        headers: new Headers({
          location:
            "https://storage.googleapis.com/bucket/installer.zip?signed=1",
        }),
        arrayBuffer: async () => {
          redirectBodyRead = true;
          throw new Error("archive body must not be consumed");
        },
      };
    },
  });

  assert.equal(result.status, 302);
  assert.equal(result.filename, "ENGRAM-0.1.0-x64.zip");
  assert.equal(result.sizeBytes, 2_671_959_069);
  assert.equal(result.redirectOrigin, "https://storage.googleapis.com");
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].url,
    "https://example.replit.app/api/download/desktop/file/ENGRAM-0.1.0-x64.zip",
  );
  assert.equal(requests[1].init.redirect, "manual");
  assert.equal(redirectBodyRead, false);
});

test("rejects a non-storage metadata source", async () => {
  await assert.rejects(
    validatePublicDesktopDownload({
      env: { ENGRAM_PUBLIC_API_URL: "https://example.replit.app" },
      fetchImpl: async () => metadataResponse({ source: "github" }),
    }),
    /Expected an App Storage-backed desktop download/,
  );
});

test("rejects missing and invalid Windows installer metadata", async () => {
  for (const installers of [
    [],
    [
      {
        os: "win",
        ext: ".zip",
        filename: "ENGRAM.zip",
        sizeBytes: 0,
        downloadPath: "/api/download/desktop/file/ENGRAM.zip",
      },
    ],
  ]) {
    await assert.rejects(
      validatePublicDesktopDownload({
        env: { ENGRAM_PUBLIC_API_URL: "https://example.replit.app" },
        fetchImpl: async () => metadataResponse({ installers }),
      }),
    );
  }
});

test("rejects streamed responses and unsafe redirect targets", async () => {
  for (const redirect of [
    {
      status: 200,
      headers: new Headers(),
      expected: /without streaming the archive/,
    },
    {
      status: 302,
      headers: new Headers({
        location: "http://storage.example/installer.zip",
      }),
      expected: /must use HTTPS/,
    },
    {
      status: 302,
      headers: new Headers(),
      expected: /Location is invalid/,
    },
  ]) {
    let requests = 0;
    await assert.rejects(
      validatePublicDesktopDownload({
        env: { ENGRAM_PUBLIC_API_URL: "https://example.replit.app" },
        fetchImpl: async () => {
          requests += 1;
          return requests === 1 ? metadataResponse() : redirect;
        },
      }),
      redirect.expected,
    );
  }
});

