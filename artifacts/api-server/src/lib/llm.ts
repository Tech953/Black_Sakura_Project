import OpenAI from "openai";

/**
 * Provider seam for the language model.
 *
 * The whole app talks to the model through this single OpenAI-compatible client,
 * so it can target either the cloud proxy or a fully local runtime
 * (Ollama, LM Studio, llama.cpp, vLLM) by changing configuration only — no code
 * changes required anywhere else.
 *
 * Resolution order (first defined wins):
 *   - LLM_BASE_URL / LLM_API_KEY / LLM_MODEL            (explicit; e.g. local)
 *   - AI_INTEGRATIONS_OPENAI_BASE_URL / ..._API_KEY     (Replit cloud default)
 */
const baseURL =
  process.env.LLM_BASE_URL ?? process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;

// Local OpenAI-compatible servers usually ignore the key but the SDK requires a
// non-empty string, so fall back to a harmless placeholder.
const apiKey =
  process.env.LLM_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "local";

/** Chat/completions model name. Override with LLM_MODEL to use a local model. */
export const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-5.4";

export type LLMProviderFailureCode =
  | "authentication"
  | "rate_limited"
  | "not_configured"
  | "empty_response"
  | "unavailable";

/**
 * Normalized provider failure used at the boundary between model calls and
 * application behavior. In particular, a provider 401 is not an engram health
 * failure: it means the configured model endpoint rejected the request.
 */
export class LLMProviderError extends Error {
  readonly code: LLMProviderFailureCode;
  readonly status?: number;

  constructor(
    code: LLMProviderFailureCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "LLMProviderError";
    this.code = code;
    this.status = options?.status;
  }
}

function providerStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Convert SDK/network failures into a small, safe vocabulary. The original
 * error remains the cause for server logs, while callers receive a message
 * that never includes the endpoint or credential.
 */
export function normalizeLLMProviderError(error: unknown): LLMProviderError {
  if (error instanceof LLMProviderError) return error;

  const status = providerStatus(error);
  const text = error instanceof Error ? error.message : String(error);
  const lower = text.toLowerCase();

  if (status === 401 || status === 403 || /\b(401|403)\b/.test(lower) || lower.includes("unauthorized")) {
    return new LLMProviderError(
      "authentication",
      "The language-model provider rejected authentication. Restore provider access or select a healthy local model.",
      { status, cause: error },
    );
  }
  if (status === 429 || lower.includes("rate limit") || lower.includes("too many requests")) {
    return new LLMProviderError(
      "rate_limited",
      "The language-model provider is rate-limiting requests. Try again shortly.",
      { status, cause: error },
    );
  }
  return new LLMProviderError(
    "unavailable",
    "The language-model provider is unavailable. Select a healthy local model or restore provider access.",
    { status, cause: error },
  );
}

export function llmProviderFailureResponse(error: unknown): {
  error: "Generation unavailable";
  code: LLMProviderFailureCode;
  message: string;
} {
  const normalized = normalizeLLMProviderError(error);
  return {
    error: "Generation unavailable",
    code: normalized.code,
    message: normalized.message,
  };
}

if (!baseURL) {
  throw new Error(
    "No language-model endpoint configured. Set LLM_BASE_URL (e.g. " +
      "http://localhost:11434/v1 for a local OpenAI-compatible server) or " +
      "AI_INTEGRATIONS_OPENAI_BASE_URL (Replit cloud integration).",
  );
}

/**
 * Shared OpenAI-compatible client. Defaults to the cloud endpoint; set
 * LLM_BASE_URL to point it at a local runtime for fully offline operation.
 */
export const llm = new OpenAI({ apiKey, baseURL });
