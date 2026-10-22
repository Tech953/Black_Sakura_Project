export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

const SELECTED_ENGRAM_STORAGE_KEY = "engram.selectedId";

export function selectedEngramStorageKey(accountId: string): string {
  return `${SELECTED_ENGRAM_STORAGE_KEY}.${accountId}`;
}

export function parseSelectedEngramId(value: string | null): number | null {
  if (value == null) return null;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function loadSelectedEngramId(
  storage: KeyValueStorage,
  accountId: string,
): Promise<number | null> {
  return parseSelectedEngramId(
    await storage.getItem(selectedEngramStorageKey(accountId)),
  );
}

export async function persistSelectedEngramId(
  storage: KeyValueStorage,
  accountId: string,
  id: number | null,
): Promise<void> {
  const key = selectedEngramStorageKey(accountId);
  if (id == null) {
    await storage.removeItem(key);
  } else {
    await storage.setItem(key, String(id));
  }
}

export interface TransmissionSummary {
  id: number;
  seen: boolean;
}

export function unseenTransmissionIds(
  transmissions: readonly TransmissionSummary[] | undefined,
): number[] {
  return (transmissions ?? []).filter((transmission) => !transmission.seen).map(
    (transmission) => transmission.id,
  );
}

export function markSeenRequest(engramId: number, ids: readonly number[]) {
  return { id: engramId, data: { ids: [...ids] } };
}

export type InquiryMode = "probe" | "develop";

export function inquiryRequest(input: {
  engramId: number;
  mode: InquiryMode;
  question: string;
  language?: string;
}) {
  return {
    id: input.engramId,
    data: {
      kind: input.mode,
      question: input.question.trim(),
      language: input.language,
    },
  };
}

export interface SseParserState {
  buffer: string;
}

export interface SseChunkResult {
  deltas: string[];
  done: boolean;
}

/**
 * Consume complete SSE lines while retaining a partial final line for the
 * next network chunk. The mobile chat screen uses this for Expo fetch streams.
 */
export function consumeSseChunk(
  state: SseParserState,
  chunk: string,
): SseChunkResult {
  state.buffer += chunk;
  const lines = state.buffer.split(/\r?\n/);
  state.buffer = lines.pop() ?? "";
  const deltas: string[] = [];
  let done = false;

  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    if (data.length === 0) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }

    let parsed: {
      content?: unknown;
      done?: boolean;
      error?: unknown;
    };
    try {
      parsed = JSON.parse(data) as typeof parsed;
    } catch {
      // Ignore malformed lines and continue the stream, matching the server's
      // best-effort SSE behavior.
      continue;
    }
    if (parsed.error) throw new Error(String(parsed.error));
    if (parsed.done) continue;
    if (typeof parsed.content === "string") deltas.push(parsed.content);
  }

  return { deltas, done };
}

export function flushSseChunk(state: SseParserState): SseChunkResult {
  if (!state.buffer) return { deltas: [], done: false };
  const trailing = `${state.buffer}\n`;
  state.buffer = "";
  return consumeSseChunk(state, trailing);
}