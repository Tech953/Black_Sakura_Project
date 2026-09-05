import { Platform } from "react-native";

import { MODEL_PATH } from "./model";
import { getModelStatus } from "./model";
import { loadLlamaModule, type LlamaModule } from "./native";
import {
  OFFLINE_LIMITS,
  boundChatMessages,
} from "./limits";

/**
 * On-device language model runtime (llama.cpp via llama.rn).
 *
 * The module is loaded lazily and only on native platforms, so web bundles and
 * environments without the native module never touch it.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type LlamaContext = Awaited<ReturnType<LlamaModule["initLlama"]>>;

let contextPromise: Promise<LlamaContext> | null = null;
let lifecycleTail: Promise<void> = Promise.resolve();

export class OfflineInferenceError extends Error {
  constructor(
    readonly code:
      | "MODEL_UNAVAILABLE"
      | "GENERATION_TIMEOUT"
      | "EMPTY_RESPONSE",
    message: string,
  ) {
    super(message);
    this.name = "OfflineInferenceError";
  }
}

function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const previous = lifecycleTail;
  let unlock!: () => void;
  lifecycleTail = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  return previous.then(work).finally(unlock);
}

function loadLlama(): LlamaModule {
  if (Platform.OS === "web") {
    throw new Error("On-device model is not available on web.");
  }
  // The local loader keeps llama.rn out of the startup path (and out of web
  // bundles), while giving native lifecycle tests a safe seam.
  return loadLlamaModule();
}

async function ensureContext(): Promise<LlamaContext> {
  const model = await getModelStatus();
  if (model.state !== "ready") {
    throw new OfflineInferenceError(
      "MODEL_UNAVAILABLE",
      "The on-device model is not downloaded or is incomplete.",
    );
  }
  if (!contextPromise) {
    const { initLlama } = loadLlama();
    contextPromise = initLlama({
      model: MODEL_PATH.replace(/^file:\/\//, ""),
      n_ctx: OFFLINE_LIMITS.modelContextTokens,
      n_batch: 256,
      n_gpu_layers: 0,
      use_mlock: false,
    }).catch((err: unknown) => {
      contextPromise = null;
      throw err;
    });
  }
  return contextPromise;
}

/** Free the model context (e.g. when offline mode is turned off). */
export async function releaseLlm(): Promise<void> {
  await runExclusive(async () => {
    const p = contextPromise;
    contextPromise = null;
    if (p) {
      try {
        const ctx = await p;
        await ctx.release();
      } catch {
        // never initialized or already released
      }
    }
  });
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/**
 * The portion of `raw` that is definitely safe to show mid-stream: complete
 * think blocks removed, any open (unterminated) think block withheld entirely,
 * and a trailing partial "<think" prefix held back until it resolves. This
 * makes fragmented tag tokens ("<th" + "ink>") impossible to leak.
 */
function trailingTagPrefixLength(value: string, tag: string): number {
  for (let length = tag.length - 1; length > 0; length -= 1) {
    if (value.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

/**
 * Return only text that is safe to display from a cumulative model stream.
 * This is pure so every possible token boundary can be checked independently.
 */
export function visibleTextWithoutThinkBlocks(raw: string): string {
  let visible = "";
  let cursor = 0;

  for (;;) {
    const open = raw.indexOf(THINK_OPEN, cursor);
    if (open === -1) {
      const remainder = raw.slice(cursor);
      const held = trailingTagPrefixLength(remainder, THINK_OPEN);
      return visible + (held ? remainder.slice(0, -held) : remainder);
    }

    visible += raw.slice(cursor, open);
    const close = raw.indexOf(THINK_CLOSE, open + THINK_OPEN.length);
    if (close === -1) return visible;
    cursor = close + THINK_CLOSE.length;
  }
}

const STOP_WORDS = ["<|im_end|>", "<|endoftext|>"];

/**
 * Stream a chat completion from the on-device model. `onToken` receives cleaned
 * incremental text (think-blocks withheld). Returns the full cleaned reply.
 */
export async function completeStream(
  messages: ChatMessage[],
  onToken: (delta: string) => void,
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  return runExclusive(async () => {
    const ctx = await ensureContext();
    const boundedMessages = boundChatMessages(messages);
    let rawText = "";
    let streamedText = "";
    let emitted = 0;

    const flush = (text: string) => {
      if (text.length > emitted) {
        onToken(text.slice(emitted));
        emitted = text.length;
      }
    };

    const consumeToken = (token: string) => {
      rawText += token;
      streamedText = visibleTextWithoutThinkBlocks(rawText);
    };

    const completion = ctx.completion(
      {
        messages: boundedMessages,
        n_predict: Math.min(
          opts.maxTokens ?? OFFLINE_LIMITS.maxOutputTokens,
          OFFLINE_LIMITS.maxOutputTokens,
        ),
        temperature: opts.temperature ?? 0.7,
        stop: STOP_WORDS,
        enable_thinking: false,
      } as Parameters<LlamaContext["completion"]>[0],
      (data: { token: string }) => {
        consumeToken(data.token);
        flush(streamedText);
      },
    );
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void ctx.stopCompletion().catch(() => {});
    }, OFFLINE_LIMITS.maxGenerationMs);

    try {
      const result = await completion;
      if (timedOut) {
        throw new OfflineInferenceError(
          "GENERATION_TIMEOUT",
          "The on-device response took too long.",
        );
      }
      const full = visibleTextWithoutThinkBlocks(
        result.text || rawText,
      ).trim();
      if (!full) {
        throw new OfflineInferenceError(
          "EMPTY_RESPONSE",
          "The on-device model returned no response.",
        );
      }
      flush(full);
      return full;
    } finally {
      clearTimeout(timeout);
      if (timedOut) await completion.catch(() => {});
    }
  });
}

/** One-shot (non-streaming) completion for inquiries/transmissions. */
export async function completeOnce(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  return completeStream(messages, () => {}, opts);
}
