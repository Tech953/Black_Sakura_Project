import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// --- Hoisted mocks for the LLM seam, openai helper, ffmpeg, and fs ------------
// extractFromMedia reaches the model ONLY through the `llm` provider seam and
// ffmpeg/ffprobe ONLY through node:child_process. Mocking those lets us assert
// the per-modality dispatch (and the env-driven binary resolution for video)
// with no cloud call and no real ffmpeg install.
const h = vi.hoisted(() => {
  const state = {
    // Each execFile(...) invocation, captured as { bin, args }.
    execCalls: [] as Array<{ bin: string; args: string[] }>,
    // What transcribeAudio gets back; "" models silence / no speech.
    transcript: "spoken words from the clip",
    // Bytes readFile returns for sampled video frames (non-empty = a frame was
    // extracted; empty Buffer = ffmpeg produced no usable frame).
    frameBuf: Buffer.from("binary-frame-bytes"),
    // Bytes readFile returns for the extracted audio track (non-empty = an audio
    // track was present; empty Buffer = no audio track to transcribe).
    audioBuf: Buffer.from("binary-audio-bytes"),
  };

  const chatCreate = vi.fn(async (_req: Record<string, unknown>) => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            observations: [
              "a lighthouse blinks twice",
              "a gull settles on the rail",
            ],
            summary: "A short harbor scene.",
          }),
        },
      },
    ],
  }));

  const transcribeCreate = vi.fn(async () => ({ text: state.transcript }));

  const llm = {
    chat: { completions: { create: chatCreate } },
    audio: { transcriptions: { create: transcribeCreate } },
  };

  return { state, chatCreate, transcribeCreate, llm };
});

vi.mock("./llm", () => ({ llm: h.llm, LLM_MODEL: "test-chat-model" }));
vi.mock("openai", () => ({
  toFile: vi.fn(async (buf: Buffer, name: string, opts: unknown) => ({
    buf,
    name,
    opts,
  })),
}));
vi.mock("node:child_process", () => ({
  // promisify(execFile) appends a (err, result) callback as the last argument.
  // Generic promisify resolves with the single value we pass after `null`, so we
  // hand back { stdout, stderr } the way the real customPromisified execFile does.
  execFile: (...args: unknown[]) => {
    const cb = args[args.length - 1] as (
      err: unknown,
      res: { stdout: string; stderr: string },
    ) => void;
    const bin = args[0] as string;
    const cmdArgs = (args[1] as string[]) ?? [];
    h.state.execCalls.push({ bin, args: cmdArgs });
    // ffprobe reports a duration; ffmpeg (frames/audio) writes files we mock via fs.
    const isProbe = cmdArgs.includes("-show_entries");
    cb(null, { stdout: isProbe ? "5.0\n" : "", stderr: "" });
  },
}));
vi.mock("node:fs/promises", () => ({
  mkdtemp: vi.fn(async (prefix: string) => `${prefix}test`),
  writeFile: vi.fn(async () => undefined),
  // Path-aware so a test can independently control the two video channels: the
  // audio track read (audio.mp3) vs. the sampled frame reads (frame-*.jpg).
  readFile: vi.fn(async (path: string) =>
    typeof path === "string" && path.includes("audio")
      ? h.state.audioBuf
      : h.state.frameBuf,
  ),
  rm: vi.fn(async () => undefined),
}));

import {
  contentMatchesMime,
  detectContentType,
  detectModality,
  filenameMatchesMime,
  MEDIA_MIME_ALLOWLIST,
  extractFromMedia,
} from "./media-extraction";

beforeEach(() => {
  vi.clearAllMocks();
  h.state.execCalls = [];
  h.state.transcript = "spoken words from the clip";
  h.state.frameBuf = Buffer.from("binary-frame-bytes");
  h.state.audioBuf = Buffer.from("binary-audio-bytes");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// --- MIME allowlist drives modality -------------------------------------------
describe("detectModality — MIME allowlist drives modality (never client input)", () => {
  it("maps allowlisted MIME types to their modality", () => {
    expect(detectModality("text/plain")).toBe("text");
    expect(detectModality("application/json")).toBe("text");
    expect(detectModality("image/png")).toBe("image");
    expect(detectModality("image/jpeg")).toBe("image");
    expect(detectModality("audio/mpeg")).toBe("audio");
    expect(detectModality("video/mp4")).toBe("video");
  });

  it("normalizes case and strips charset/codec parameters", () => {
    expect(detectModality("TEXT/Plain")).toBe("text");
    expect(detectModality("text/plain; charset=utf-8")).toBe("text");
    expect(detectModality("  image/png ")).toBe("image");
    expect(detectModality('video/webm;codecs="vp9"')).toBe("video");
  });

  it("returns null for anything not on the allowlist", () => {
    expect(detectModality("application/zip")).toBeNull();
    expect(detectModality("application/x-msdownload")).toBeNull();
    expect(detectModality("")).toBeNull();
    expect(detectModality("text/")).toBeNull();
  });

  it("every allowlist value is a known modality", () => {
    const allowed = new Set(["text", "image", "audio", "video"]);
    for (const modality of Object.values(MEDIA_MIME_ALLOWLIST)) {
      expect(allowed.has(modality)).toBe(true);
    }
  });
});

describe("detectContentType — uploaded bytes must match the claimed MIME", () => {
  it("recognizes representative signatures for all four modalities", () => {
    expect(detectContentType(Buffer.from("the harbor was quiet"))).toBe("text/plain");
    expect(detectContentType(Buffer.from('{"harbor":"quiet"}'))).toBe("application/json");
    expect(detectContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      "image/png",
    );
    expect(detectContentType(Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]))).toBe(
      "audio/mpeg",
    );
    expect(
      detectContentType(
        Buffer.from([
          0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        ]),
      ),
    ).toBe("video/mp4");
  });

  it("accepts valid aliases and rejects mislabeled or executable bytes", () => {
    const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00]);
    expect(contentMatchesMime(mp3, "audio/mpeg")).toBe(true);
    expect(contentMatchesMime(mp3, "audio/mp3")).toBe(true);
    expect(contentMatchesMime(mp3, "image/png")).toBe(false);
    const wav = Buffer.from("RIFFxxxxWAVE");
    expect(contentMatchesMime(wav, "audio/x-wav")).toBe(true);

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(contentMatchesMime(png, "image/png")).toBe(true);
    expect(contentMatchesMime(png, "text/plain")).toBe(false);
    expect(contentMatchesMime(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), "text/plain")).toBe(false);
  });

  it("rejects a filename extension that contradicts an otherwise valid MIME type", () => {
    expect(filenameMatchesMime("scene.png", "image/png")).toBe(true);
    expect(filenameMatchesMime("scene.jpg", "image/png")).toBe(false);
    expect(filenameMatchesMime("notes.md", "text/markdown")).toBe(true);
    expect(filenameMatchesMime("notes.txt", "text/markdown")).toBe(false);
    expect(filenameMatchesMime("README", "text/plain")).toBe(true);
  });
});

// --- extractFromMedia: per-modality dispatch ----------------------------------
describe("extractFromMedia — text", () => {
  it("perceives a text document via the chat model, no transcript", async () => {
    const result = await extractFromMedia(
      { modality: "text", mimeType: "text/plain", filename: "harbor.txt" },
      Buffer.from("The harbor was quiet at dawn."),
    );

    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.summary).toBe("A short harbor scene.");
    expect(result.transcript).toBeNull();
    // One chat call, the main chat model, no transcription.
    expect(h.chatCreate).toHaveBeenCalledTimes(1);
    expect(h.chatCreate.mock.calls[0][0]).toMatchObject({ model: "test-chat-model" });
    expect(h.transcribeCreate).not.toHaveBeenCalled();
  });
});

describe("extractFromMedia — image", () => {
  it("perceives an image via the vision model using a base64 data URL", async () => {
    const result = await extractFromMedia(
      { modality: "image", mimeType: "image/png", filename: "scene.png" },
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );

    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.transcript).toBeNull();
    expect(h.chatCreate).toHaveBeenCalledTimes(1);

    // The image is handed to the model as a data URL, never a raw path/field.
    const req = h.chatCreate.mock.calls[0][0] as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const userMsg = req.messages.find((m) => m.role === "user")!;
    const parts = userMsg.content as Array<{ type: string; image_url?: { url: string } }>;
    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart?.image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(h.transcribeCreate).not.toHaveBeenCalled();
  });
});

describe("extractFromMedia — audio", () => {
  it("transcribes then extracts observations from the transcript", async () => {
    h.state.transcript = "the captain logged a heading of due north";

    const result = await extractFromMedia(
      { modality: "audio", mimeType: "audio/mpeg", filename: "log.mp3" },
      Buffer.from("audio-bytes"),
    );

    expect(h.transcribeCreate).toHaveBeenCalledTimes(1);
    expect(result.transcript).toBe("the captain logged a heading of due north");
    expect(result.observations.length).toBeGreaterThan(0);
    // Exactly one chat call: extraction over the transcript text.
    expect(h.chatCreate).toHaveBeenCalledTimes(1);
  });

  it("returns no observations when the audio has no discernible speech", async () => {
    h.state.transcript = "";

    const result = await extractFromMedia(
      { modality: "audio", mimeType: "audio/mpeg", filename: "silent.mp3" },
      Buffer.from("audio-bytes"),
    );

    expect(result.observations).toEqual([]);
    expect(result.transcript).toBe("");
    expect(result.summary).toMatch(/no discernible speech/i);
    // No transcript means nothing to extract — the chat model is never called.
    expect(h.chatCreate).not.toHaveBeenCalled();
  });
});

// --- parseExtractionJson (exercised via the text path) ------------------------
// parseExtractionJson is intentionally not exported; the text modality calls it
// directly on the chat reply (extractFromMedia → extractFromText →
// parseExtractionJson), so crafting the chat reply lets us cover its parsing
// branches without weakening its encapsulation. The result's `observations` +
// `summary` come straight back through, untouched.
describe("parseExtractionJson (via extractFromMedia text path)", () => {
  // Set the next chat reply, then perceive a text document so the reply flows
  // through parseExtractionJson unchanged.
  async function perceiveTextWithReply(content: string) {
    h.chatCreate.mockResolvedValueOnce({
      choices: [{ message: { content } }],
    });
    return extractFromMedia(
      { modality: "text", mimeType: "text/plain", filename: "doc.txt" },
      Buffer.from("the document body to perceive"),
    );
  }

  it("parses a clean JSON object", async () => {
    const result = await perceiveTextWithReply(
      JSON.stringify({
        observations: ["a beacon turns", "the tide is out"],
        summary: "A calm coastline.",
      }),
    );

    expect(result.observations).toEqual(["a beacon turns", "the tide is out"]);
    expect(result.summary).toBe("A calm coastline.");
    expect(result.transcript).toBeNull();
  });

  it("parses JSON wrapped in ```json fences", async () => {
    const result = await perceiveTextWithReply(
      '```json\n{"observations": ["a single fact"], "summary": "One thing."}\n```',
    );

    expect(result.observations).toEqual(["a single fact"]);
    expect(result.summary).toBe("One thing.");
  });

  it("parses JSON embedded in surrounding prose", async () => {
    const result = await perceiveTextWithReply(
      'Sure! Here is what I found:\n' +
        '{"observations": ["one", "two"], "summary": "Two things."}\n' +
        "Hope that helps!",
    );

    expect(result.observations).toEqual(["one", "two"]);
    expect(result.summary).toBe("Two things.");
  });

  it("falls back to line parsing when the reply is plain bullet/numbered lines, not JSON", async () => {
    const result = await perceiveTextWithReply(
      "- The lighthouse blinks twice\n" +
        "* A gull rests on the rail\n" +
        "1. Fog rolls across the bay",
    );

    // Leading bullet/number markers are stripped; the first line is the summary.
    expect(result.observations).toEqual([
      "The lighthouse blinks twice",
      "A gull rests on the rail",
      "Fog rolls across the bay",
    ]);
    expect(result.summary).toBe("The lighthouse blinks twice");
  });

  it("falls back to line parsing when an attempted JSON object is malformed (truncated / trailing comma)", async () => {
    // A real LLM failure: it tries to emit the JSON object but the payload is
    // syntactically broken (unterminated string + trailing comma + truncation).
    // JSON.parse throws, so the parser drops to line extraction over the raw reply.
    const result = await perceiveTextWithReply(
      '{\n' +
        '  "observations": [\n' +
        '    "the reactor hums steadily",\n' +
        '    "a warning light flickers,\n' +
        '  ],\n' +
        '  "summary":',
    );

    // Each non-blank raw line, with leading JSON/list punctuation stripped by the
    // ^[-*\\d.\\s]+ rule, survives as an observation; the first line is the summary.
    expect(result.observations).toContain('"observations": [');
    expect(result.observations.some((o) => o.includes("the reactor hums steadily"))).toBe(
      true,
    );
    expect(
      result.observations.some((o) => o.includes("a warning light flickers")),
    ).toBe(true);
    expect(result.summary).toBe("{");
  });

  it("falls back to line parsing when fenced JSON contains a syntax error", async () => {
    // The model wraps its answer in ```json fences but the JSON has an invalid
    // token, so fence-stripping still yields unparseable text → line fallback.
    const result = await perceiveTextWithReply(
      "```json\n" +
        "{ observations: [the lens is cracked, the frame is bent] }\n" +
        "```",
    );

    // Fences are stripped first; the remaining (unparseable) line is kept verbatim
    // aside from leading list/number punctuation.
    expect(result.observations.length).toBeGreaterThan(0);
    expect(
      result.observations.some((o) => o.includes("the lens is cracked")),
    ).toBe(true);
  });

  it("filters blank/whitespace-only entries in the JSON path", async () => {
    const result = await perceiveTextWithReply(
      JSON.stringify({
        observations: ["a real observation", "", "   ", "another real one"],
        summary: "  trimmed summary  ",
      }),
    );

    expect(result.observations).toEqual([
      "a real observation",
      "another real one",
    ]);
    expect(result.summary).toBe("trimmed summary");
  });

  it("filters blank lines in the line-parsing fallback", async () => {
    const result = await perceiveTextWithReply(
      "- alpha\n\n- beta\n   \n- gamma\n",
    );

    expect(result.observations).toEqual(["alpha", "beta", "gamma"]);
  });

  it("caps observations at MAX_OBSERVATIONS (8) in the JSON path", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `observation ${i + 1}`);
    const result = await perceiveTextWithReply(
      JSON.stringify({ observations: many, summary: "Too many facts." }),
    );

    expect(result.observations).toHaveLength(8);
    expect(result.observations[0]).toBe("observation 1");
    expect(result.observations[7]).toBe("observation 8");
    expect(result.observations).not.toContain("observation 9");
  });

  it("caps observations at MAX_OBSERVATIONS (8) in the line-parsing fallback", async () => {
    const lines = Array.from({ length: 12 }, (_, i) => `- line ${i + 1}`).join(
      "\n",
    );
    const result = await perceiveTextWithReply(lines);

    expect(result.observations).toHaveLength(8);
    expect(result.observations[0]).toBe("line 1");
    expect(result.observations[7]).toBe("line 8");
  });

  it("returns empty observations and summary for an empty reply", async () => {
    const result = await perceiveTextWithReply("");

    expect(result.observations).toEqual([]);
    expect(result.summary).toBe("");
  });
});

describe("extractFromMedia — unsupported modality", () => {
  it("throws for a modality outside the known set", async () => {
    await expect(
      extractFromMedia(
        { modality: "hologram", mimeType: "x/y", filename: "z" },
        Buffer.from(""),
      ),
    ).rejects.toThrow(/Unsupported media modality/i);
  });
});

// --- extractFromMedia: video (ffmpeg/ffprobe mocked, binaries from env) --------
describe("extractFromMedia — video", () => {
  it("samples frames + extracts audio, resolving binaries from FFMPEG_PATH/FFPROBE_PATH", async () => {
    // FFMPEG_BIN/FFPROBE_BIN are module-level consts read from env at import time,
    // so set the env and re-import the module to exercise the env-driven paths.
    vi.resetModules();
    vi.stubEnv("FFMPEG_PATH", "/opt/bin/ffmpeg");
    vi.stubEnv("FFPROBE_PATH", "/opt/bin/ffprobe");
    h.state.transcript = "audio narration from the video";

    const { extractFromMedia: extract } = await import("./media-extraction");
    const result = await extract(
      { modality: "video", mimeType: "video/mp4", filename: "clip.mp4" },
      Buffer.from("video-bytes"),
    );

    // ffprobe (duration) + ffmpeg (frame/audio) ran with the env-provided binaries.
    const bins = new Set(h.state.execCalls.map((c) => c.bin));
    expect(bins.has("/opt/bin/ffprobe")).toBe(true);
    expect(bins.has("/opt/bin/ffmpeg")).toBe(true);

    // Both perception channels contributed: vision frames + an audio transcript.
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.transcript).toBe("audio narration from the video");
    expect(h.transcribeCreate).toHaveBeenCalledTimes(1);
    // Two chat calls: one over the sampled frames, one over the audio transcript.
    expect(h.chatCreate).toHaveBeenCalledTimes(2);
  });

  it("frames-only: a video with no speech still perceives the frames (empty transcript)", async () => {
    // ffmpeg extracts an audio track, but transcription comes back empty — the
    // clip has frames but no discernible speech. The vision channel must still
    // produce observations and the transcript must be reported as null.
    h.state.transcript = "";

    const result = await extractFromMedia(
      { modality: "video", mimeType: "video/mp4", filename: "silent-clip.mp4" },
      Buffer.from("video-bytes"),
    );

    // Transcription was attempted (audio track present) but yielded nothing, so
    // no audio-extraction chat call happens — only the vision pass over frames.
    expect(h.transcribeCreate).toHaveBeenCalledTimes(1);
    expect(h.chatCreate).toHaveBeenCalledTimes(1);
    expect(result.observations.length).toBeGreaterThan(0);
    // Empty transcript collapses to null (no audio channel to report).
    expect(result.transcript).toBeNull();
    expect(result.summary).toBe("A short harbor scene.");
  });

  it("audio-only: a video whose frames can't be extracted still perceives the audio", async () => {
    // ffmpeg writes no usable frame (empty frame buffers) but the audio track is
    // present and transcribes — the audio channel alone must carry perception.
    h.state.frameBuf = Buffer.from("");
    h.state.transcript = "the captain logged a heading of due north";

    const result = await extractFromMedia(
      { modality: "video", mimeType: "video/mp4", filename: "audio-only.mp4" },
      Buffer.from("video-bytes"),
    );

    // No frames means the vision pass is skipped; only the transcript is perceived.
    expect(h.transcribeCreate).toHaveBeenCalledTimes(1);
    expect(h.chatCreate).toHaveBeenCalledTimes(1);
    expect(result.observations.length).toBeGreaterThan(0);
    expect(result.transcript).toBe("the captain logged a heading of due north");
  });

  it("throws when neither frames nor audio can be extracted", async () => {
    // Empty frame buffers AND an empty audio track: there is nothing to perceive,
    // so extraction fails loudly rather than silently returning an empty result.
    h.state.frameBuf = Buffer.from("");
    h.state.audioBuf = Buffer.from("");

    await expect(
      extractFromMedia(
        { modality: "video", mimeType: "video/mp4", filename: "empty.mp4" },
        Buffer.from("video-bytes"),
      ),
    ).rejects.toThrow(/Could not extract any frames or audio from the video/i);

    // No usable audio bytes ⇒ transcription is never attempted.
    expect(h.transcribeCreate).not.toHaveBeenCalled();
    expect(h.chatCreate).not.toHaveBeenCalled();
  });

  it("caps combined observations at MAX_OBSERVATIONS (8) when both channels contribute", async () => {
    // Vision returns 5 observations, audio returns 5 — combined 10 must be
    // clamped to the 8-observation cap, preserving vision-first ordering.
    h.state.transcript = "a long narration with many distinct facts";
    const five = (label: string) =>
      Array.from({ length: 5 }, (_, i) => `${label} ${i + 1}`);
    // First chat call = vision over frames; second = audio transcript extraction.
    h.chatCreate
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                observations: five("frame"),
                summary: "Frames.",
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                observations: five("audio"),
                summary: "Audio.",
              }),
            },
          },
        ],
      });

    const result = await extractFromMedia(
      { modality: "video", mimeType: "video/mp4", filename: "rich.mp4" },
      Buffer.from("video-bytes"),
    );

    expect(h.chatCreate).toHaveBeenCalledTimes(2);
    expect(result.observations).toHaveLength(8);
    // Vision observations come first, then audio fills the remainder up to 8.
    expect(result.observations[0]).toBe("frame 1");
    expect(result.observations[4]).toBe("frame 5");
    expect(result.observations[5]).toBe("audio 1");
    expect(result.observations[7]).toBe("audio 3");
    expect(result.observations).not.toContain("audio 4");
  });
});
