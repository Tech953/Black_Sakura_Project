import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import { Readable } from "node:stream";
import {
  APK_MIME,
  OCTET_MIME,
  safeAttachment,
  resolveApk,
  resolveDesktop,
  findDesktopInstaller,
} from "../lib/downloads";

// Plain Express download routes (deliberately NOT in the OpenAPI spec, like the
// media raw/upload routes). Everything is served same-origin through the deploy:
//   GET /api/download/android            -> JSON meta
//   GET /api/download/android.apk        -> the apk binary
//   GET /api/download/desktop            -> JSON meta (per-OS installers)
//   GET /api/download/desktop/file/:name -> a single installer binary
// Desktop binaries resolve bundled -> App Storage -> GitHub. App Storage uses
// a short-lived direct redirect so multi-GB installers do not transit Node.
const router = Router();

function desktopDownloadPath(filename: string): string {
  return `/api/download/desktop/file/${encodeURIComponent(filename)}`;
}

/** Parse a single-range `Range: bytes=a-b` header. Returns null when absent
 * or unsupported (multi-range / non-bytes), and "invalid" when unsatisfiable. */
function parseRange(
  header: string | undefined,
  sizeBytes: number,
): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null; // multi-range or malformed — serve the whole file
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    // suffix range: last N bytes
    const n = Number(b);
    if (n === 0) return "invalid";
    start = Math.max(0, sizeBytes - n);
    end = sizeBytes - 1;
  } else {
    start = Number(a);
    end = b === "" ? sizeBytes - 1 : Math.min(Number(b), sizeBytes - 1);
  }
  if (start >= sizeBytes || start > end) return "invalid";
  return { start, end };
}

/** Stream a local file as an attachment, honoring single-range requests so
 * browsers can resume interrupted multi-GB downloads instead of erroring. */
function streamLocalFile(
  req: Request,
  res: Response,
  filePath: string,
  filename: string,
  mime: string,
  sizeBytes: number,
): void {
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", safeAttachment(filename));
  res.setHeader("Accept-Ranges", "bytes");

  const range = parseRange(req.headers.range, sizeBytes);
  if (range === "invalid") {
    res.setHeader("Content-Range", `bytes */${sizeBytes}`);
    res.status(416).end();
    return;
  }
  let readOpts: { start: number; end: number } | undefined;
  if (range) {
    res.status(206);
    res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${sizeBytes}`);
    res.setHeader("Content-Length", String(range.end - range.start + 1));
    readOpts = range;
  } else {
    res.setHeader("Content-Length", String(sizeBytes));
  }
  const stream = fs.createReadStream(filePath, readOpts);
  res.on("close", () => stream.destroy());
  stream.on("error", (err) => {
    req.log.error(err, "Failed to stream bundled download");
    if (!res.headersSent) {
      res.status(500).json({ error: "Could not read the file." });
    } else {
      res.destroy();
    }
  });
  stream.pipe(res);
}

/** Proxy-stream a remote URL as an attachment, aborting if the client leaves. */
async function proxyDownload(
  req: Request,
  res: Response,
  url: string,
  filename: string,
  mime: string,
  sizeBytes: number,
): Promise<void> {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "engram-download",
        Accept: "application/octet-stream",
      },
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      req.log.error(
        { status: upstream.status },
        "Upstream download fetch failed",
      );
      res
        .status(502)
        .json({ error: "Could not fetch the file from the release host." });
      return;
    }
    res.setHeader("Content-Type", mime);
    if (sizeBytes) res.setHeader("Content-Length", String(sizeBytes));
    res.setHeader("Content-Disposition", safeAttachment(filename));
    const nodeStream = Readable.fromWeb(
      upstream.body as Parameters<typeof Readable.fromWeb>[0],
    );
    nodeStream.on("error", (err) => {
      if (controller.signal.aborted) {
        res.destroy();
        return;
      }
      req.log.error(err, "Error while proxying download");
      if (!res.headersSent) {
        res.status(502).json({ error: "Download interrupted." });
      } else {
        res.destroy();
      }
    });
    nodeStream.pipe(res);
  } catch (err) {
    if (controller.signal.aborted) return;
    req.log.error(err, "Proxy download failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Could not download the file." });
    }
  }
}

// ---- Android ----

router.get("/download/android", async (_req, res) => {
  const apk = await resolveApk();
  if (!apk) {
    res.json({
      available: false,
      source: null,
      version: null,
      filename: null,
      sizeBytes: null,
      downloadPath: null,
    });
    return;
  }
  res.json({
    available: true,
    source: apk.kind,
    version: apk.version,
    filename: apk.filename,
    sizeBytes: apk.sizeBytes,
    downloadPath: "/api/download/android.apk",
  });
});

router.get("/download/android.apk", async (req, res) => {
  const apk = await resolveApk();
  if (!apk) {
    res.status(404).json({ error: "No Android APK is available for download." });
    return;
  }
  if (apk.kind === "bundled") {
    streamLocalFile(req, res, apk.localPath, apk.filename, APK_MIME, apk.sizeBytes);
  } else {
    await proxyDownload(req, res, apk.url, apk.filename, APK_MIME, apk.sizeBytes);
  }
});

// ---- Desktop ----

router.get("/download/desktop", async (_req, res) => {
  const { source, version, installers } = await resolveDesktop();
  res.json({
    available: installers.length > 0,
    source,
    version,
    installers: installers.map((i) => ({
      os: i.os,
      ext: i.ext,
      filename: i.filename,
      sizeBytes: i.sizeBytes,
      downloadPath: desktopDownloadPath(i.filename),
    })),
  });
});

router.get("/download/desktop/file/:name", async (req, res) => {
  const installer = await findDesktopInstaller(req.params.name);
  if (!installer) {
    res
      .status(404)
      .json({ error: "That installer is not available for download." });
    return;
  }
  if (installer.source === "bundled") {
    streamLocalFile(
      req,
      res,
      installer.localPath,
      installer.filename,
      OCTET_MIME,
      installer.sizeBytes,
    );
  } else if (installer.source === "storage") {
    res.redirect(302, installer.url);
  } else {
    await proxyDownload(
      req,
      res,
      installer.url,
      installer.filename,
      OCTET_MIME,
      installer.sizeBytes,
    );
  }
});

export default router;
