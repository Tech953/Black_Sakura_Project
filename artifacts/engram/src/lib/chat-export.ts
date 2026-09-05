export interface ChatExportMessage {
  role: "user" | "assistant" | "context";
  content: string;
  speakerEngramId?: number | null;
  createdAt?: string;
}

export interface ChatExportEntry {
  heading: string;
  timestamp: string;
  content: string;
}

export function buildTranscriptEntries(
  messages: ChatExportMessage[],
  labels: {
    you: string;
    perceivedContext: string;
    engramFallback: string;
    speakerName: (speakerEngramId?: number | null) => string;
    defaultAssistant: string;
  },
): ChatExportEntry[] {
  return messages
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({
      heading:
        message.role === "user"
          ? labels.you
          : message.role === "context"
            ? labels.perceivedContext
            : message.speakerEngramId != null
              ? labels.speakerName(message.speakerEngramId)
              : labels.defaultAssistant || labels.engramFallback,
      timestamp: message.createdAt ? new Date(message.createdAt).toISOString() : "",
      content: message.content,
    }));
}

export function buildMarkdownTranscript(input: {
  title: string;
  downloadedOn: string;
  exportedAt: string;
  conversationCreated: string;
  createdAt: string;
  entries: ChatExportEntry[];
}): string {
  return [
    `# ${input.title}`,
    "",
    `_${input.downloadedOn}: ${input.exportedAt}_`,
    `_${input.conversationCreated}: ${new Date(input.createdAt).toISOString()}_`,
    "",
    ...input.entries.flatMap((entry) => [
      `## ${entry.heading}`,
      ...(entry.timestamp ? [`_${entry.timestamp}_`] : []),
      "",
      entry.content,
      "",
    ]),
  ].join("\n");
}

export function buildPlainTextTranscript(input: {
  title: string;
  downloadedOn: string;
  exportedAt: string;
  conversationCreated: string;
  createdAt: string;
  entries: ChatExportEntry[];
}): string {
  return [
    input.title,
    `${input.downloadedOn}: ${input.exportedAt}`,
    `${input.conversationCreated}: ${new Date(input.createdAt).toISOString()}`,
    "",
    ...input.entries.flatMap((entry) => [
      entry.heading,
      ...(entry.timestamp ? [entry.timestamp] : []),
      entry.content,
      "",
    ]),
  ].join("\n");
}