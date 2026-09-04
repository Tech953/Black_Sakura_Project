export const OFFLINE_LIMITS = {
  modelContextTokens: 2048,
  maxInputChars: 4000,
  maxContextChars: 6500,
  maxSystemChars: 4400,
  maxHistoryMessageChars: 1600,
  maxOutputTokens: 384,
  maxGenerationMs: 120_000,
} as const;

export class OfflineInputError extends Error {
  readonly code = "INPUT_TOO_LARGE";

  constructor(message = "Offline input is too long.") {
    super(message);
    this.name = "OfflineInputError";
  }
}

export function assertOfflineInput(value: string): void {
  if (value.trim().length > OFFLINE_LIMITS.maxInputChars) {
    throw new OfflineInputError();
  }
}

function trimForContext(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const tailChars = Math.floor(maxChars * 0.2);
  const headChars = maxChars - tailChars;
  return `${value.slice(0, headChars)}\n[…context trimmed…]\n${value.slice(-tailChars)}`;
}

export function boundChatMessages<T extends { role: string; content: string }>(
  messages: T[],
): T[] {
  const system = messages.find((message) => message.role === "system");
  const nonSystem = messages.filter((message) => message !== system);
  const boundedSystem = system
    ? { ...system, content: trimForContext(system.content, OFFLINE_LIMITS.maxSystemChars) }
    : null;
  let used = boundedSystem?.content.length ?? 0;
  const selected: T[] = [];

  for (let index = nonSystem.length - 1; index >= 0; index -= 1) {
    const message = nonSystem[index];
    const content = trimForContext(message.content, OFFLINE_LIMITS.maxHistoryMessageChars);
    const cost = content.length + 24;
    if (used + cost > OFFLINE_LIMITS.maxContextChars) break;
    selected.push({ ...message, content });
    used += cost;
  }

  selected.reverse();
  return boundedSystem ? [boundedSystem, ...selected] : selected;
}