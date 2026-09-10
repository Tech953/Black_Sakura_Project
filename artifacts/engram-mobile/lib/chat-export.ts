import { strToU8, zipSync } from "fflate";

export interface MobileChatExportMessage {
  role: "user" | "assistant" | "context";
  content: string;
  speakerEngramId?: number | null;
  createdAt?: string;
}

export interface MobileChatExportEntry {
  heading: string;
  timestamp: string;
  content: string;
}

export interface MobileChatExportDocument {
  title: string;
  downloadedOn: string;
  exportedAt: string;
  conversationCreated: string;
  createdAt: string;
  entries: MobileChatExportEntry[];
}

export function buildTranscriptEntries(
  messages: MobileChatExportMessage[],
  labels: {
    you: string;
    perceivedContext: string;
    engramFallback: string;
    speakerName: (speakerEngramId?: number | null) => string;
    defaultAssistant: string;
  },
): MobileChatExportEntry[] {
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

export function buildMarkdownTranscript(input: MobileChatExportDocument): string {
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

export function buildPlainTextTranscript(input: MobileChatExportDocument): string {
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

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraph(text: string, bold = false): string {
  const properties = bold ? "<w:pPr><w:spacing w:after=\"120\"/></w:pPr>" : "";
  const runProperties = bold ? "<w:rPr><w:b/></w:rPr>" : "";
  return `<w:p>${properties}<w:r>${runProperties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function buildDocxBytes(input: MobileChatExportDocument): Uint8Array {
  const body = [
    paragraph(input.title, true),
    paragraph(`${input.downloadedOn}: ${input.exportedAt}`),
    paragraph(`${input.conversationCreated}: ${new Date(input.createdAt).toISOString()}`),
    ...input.entries.flatMap((entry) => [
      paragraph(entry.heading, true),
      ...(entry.timestamp ? [paragraph(entry.timestamp)] : []),
      ...entry.content.split(/\r?\n/).map((line) => paragraph(line)),
    ]),
  ].join("");

  return zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        `</Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
        `</Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:body>${body}<w:sectPr/></w:body></w:document>`,
    ),
  });
}

export function escapeHtml(value: string): string {
  return escapeXml(value).replace(/\n/g, "<br/>");
}