import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { contentMatchesMime } from "../lib/media-extraction";
import { FFMPEG_BIN, FFPROBE_BIN } from "../lib/media-toolchain";

const execFileAsync = promisify(execFile);

type Fixture = {
  container: string;
  extension: string;
  mime: string;
  generateArgs: string[];
  formatName: string;
  streamType: "audio" | "video";
  codec: string;
  majorBrand?: string;
};

const fixtures: Fixture[] = [
  {
    container: "WAV/PCM",
    extension: ".wav",
    mime: "audio/wav",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=8000:duration=0.025",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "8000",
      "-ac",
      "1",
    ],
    formatName: "wav",
    streamType: "audio",
    codec: "pcm_s16le",
  },
  {
    container: "Ogg/Opus",
    extension: ".ogg",
    mime: "audio/ogg",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=8000:duration=0.08",
      "-c:a",
      "libopus",
      "-b:a",
      "16k",
    ],
    formatName: "ogg",
    streamType: "audio",
    codec: "opus",
  },
  {
    container: "MP3",
    extension: ".mp3",
    mime: "audio/mpeg",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=8000:duration=0.025",
      "-map_metadata",
      "-1",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "32k",
      "-write_xing",
      "0",
      "-id3v2_version",
      "0",
      "-write_id3v1",
      "0",
    ],
    formatName: "mp3",
    streamType: "audio",
    codec: "mp3",
  },
  {
    container: "WebM/VP8",
    extension: ".webm",
    mime: "video/webm",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "color=c=purple:s=16x16:r=1:d=1",
      "-c:v",
      "libvpx",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-pix_fmt",
      "yuv420p",
    ],
    formatName: "webm",
    streamType: "video",
    codec: "vp8",
  },
  {
    container: "Matroska/FFV1",
    extension: ".mkv",
    mime: "video/x-matroska",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=16x16:r=1:d=1",
      "-c:v",
      "ffv1",
    ],
    formatName: "matroska",
    streamType: "video",
    codec: "ffv1",
  },
  {
    container: "QuickTime/MJPEG",
    extension: ".mov",
    mime: "video/quicktime",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "color=c=green:s=16x16:r=1:d=1",
      "-frames:v",
      "1",
      "-c:v",
      "mjpeg",
      "-pix_fmt",
      "yuvj420p",
      "-brand",
      "qt  ",
    ],
    formatName: "mov",
    streamType: "video",
    codec: "mjpeg",
    majorBrand: "qt  ",
  },
  {
    container: "MP4/H.264",
    extension: ".mp4",
    mime: "video/mp4",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "color=c=yellow:s=16x16:r=1:d=1",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-brand",
      "isom",
    ],
    formatName: "mp4",
    streamType: "video",
    codec: "h264",
    majorBrand: "isom",
  },
  {
    container: "JPEG/MJPEG",
    extension: ".jpg",
    mime: "image/jpeg",
    generateArgs: [
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=16x16:r=1:d=1",
      "-frames:v",
      "1",
      "-q:v",
      "2",
    ],
    formatName: "jpeg_pipe",
    streamType: "video",
    codec: "mjpeg",
  },
];

describe("offline media toolchain fixtures", () => {
  it.each(fixtures)(
    "$mime ($container) probes and fully decodes with the extraction binaries",
    async (fixture) => {
      // Keep this smoke test limited to local fixture generation, the pure MIME
      // validator, and local ffmpeg/ffprobe processes. It intentionally does not
      // import the worker, database, media store, or any provider-call path.
      const directory = await mkdtemp(join(tmpdir(), "media-toolchain-smoke-"));
      const file = join(directory, `fixture${fixture.extension}`);
      const runTool = async (
        binary: string,
        args: string[],
        operation: string,
      ): Promise<string> => {
        try {
          const { stdout } = await execFileAsync(binary, args, {
            encoding: "utf8",
            timeout: 30_000,
            maxBuffer: 1024 * 1024,
          });
          return stdout;
        } catch (error) {
          const details = error instanceof Error ? error.message : String(error);
          throw new Error(
            `${fixture.mime} (${fixture.container}) failed during ${operation}: ${details}`,
            { cause: error },
          );
        }
      };

      try {
        await runTool(
          FFMPEG_BIN,
          ["-hide_banner", "-loglevel", "error", "-y", ...fixture.generateArgs, file],
          "offline fixture generation",
        );

        const bytes = await readFile(file);
        expect(contentMatchesMime(bytes, fixture.mime)).toBe(true);

        const probeOutput = await runTool(
          FFPROBE_BIN,
          [
            "-v",
            "error",
            "-show_entries",
            "format=format_name:format_tags=major_brand:stream=codec_type,codec_name",
            "-of",
            "json",
            file,
          ],
          "ffprobe",
        );
        const probe = JSON.parse(probeOutput) as {
          format: { format_name: string; tags?: { major_brand?: string } };
          streams: Array<{ codec_type: string; codec_name: string }>;
        };

        expect(probe.format.format_name.split(",")).toContain(fixture.formatName);
        expect(
          probe.streams.some(
            (stream) =>
              stream.codec_type === fixture.streamType &&
              stream.codec_name === fixture.codec,
          ),
        ).toBe(true);
        if (fixture.majorBrand) {
          expect(probe.format.tags?.major_brand).toBe(fixture.majorBrand);
        }

        await runTool(
          FFMPEG_BIN,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-xerror",
            "-nostdin",
            "-i",
            file,
            "-map",
            "0:v:0?",
            "-map",
            "0:a:0?",
            "-f",
            "null",
            "-",
          ],
          "full decode",
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
});
