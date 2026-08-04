import { Platform } from "react-native";

import { MODEL_PATH } from "./model";

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

type LlamaModule = typeof import("llama.rn");
type LlamaContext = Awaited<ReturnType<LlamaModule["initLlama"]>>;

let contextPromise: Promise<LlamaContext> | null = null;

function loadLlama(): LlamaModule {
  if (Platform.OS === "web") {
    throw new Error("On-device model is not available on web.");
  }
  // Lazy require keeps llama.rn out of the startup path (and out of web bundles).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("llama.rn") as LlamaModule;
}

async function ensureContext(): Promise<LlamaContext> {
  if (!contextPromise) {
    const { initLlama } = loadLlama();
    contextPromise = initLlama({
      model: MODEL_PATH.replace(/^file:\/\//, ""),
      n_ctx: 4096,
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
  const p = contextPromise;
  contextPromise = null;
  if (p) {
    try {
      const ctx = await p;
      await ctx.release();
    } catch {
      // never initialized
    }
  }
}

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Strip Qwen3 <think> blocks — reasoning must never leak into the reply. */
function stripThink(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<think>[\s\S]*$/g, "")
    .trim();
}

/**
 * The portion of `raw` that is definitely safe to show mid-stream: complete
 * think blocks removed, any open (unterminated) think block withheld entirely,
 * and a trailing partial "<think" prefix held back until it resolves. This
 * makes fragmented tag tokens ("<th" + "ink>") impossible to leak.
 */
function visibleText(raw: string): string {
  let s = raw;
  for (;;) {
    const open = s.indexOf(THINK_OPEN);
    if (open === -1) break;
    const close = s.indexOf(THINK_CLOSE, open);
    if (close === -1) return s.slice(0, open); // inside a think block — withhold the rest
    s = s.slice(0, open) + s.slice(close + THINK_CLOSE.length);
  }
  // Hold back a trailing partial "<think>" prefix (e.g. raw ends with "<thi").
  for (let k = THINK_OPEN.length - 1; k > 0; k--) {
    if (s.endsWith(THINK_OPEN.slice(0, k))) return s.slice(0, s.length - k);
  }
  return s;
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
  const ctx = await ensureContext();
  let raw = "";
  let emitted = 0;

  const flush = (text: string) => {
    if (text.length > emitted) {
      onToken(text.slice(emitted));
      emitted = text.length;
    }
  };

  const result = await ctx.completion(
    {
      messages,
      n_predict: opts.maxTokens ?? 768,
      temperature: opts.temperature ?? 0.7,
      stop: STOP_WORDS,
      enable_thinking: false,
    } as Parameters<LlamaContext["completion"]>[0],
    (data: { token: string }) => {
      raw += data.token;
      flush(visibleText(raw));
    },
  );

  raw = result.text ?? raw;
  const full = stripThink(raw);
  flush(full);
  return full;
}

/** One-shot (non-streaming) completion for inquiries/transmissions. */
export async function completeOnce(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  return completeStream(messages, () => {}, opts);
}
