import {
  buildDocxBytes,
  buildMarkdownTranscript,
  buildPdfBytes,
  buildPlainTextTranscript,
  type MobileChatExportDocument,
} from "./chat-export";

export type WebChatExportFormat = "md" | "txt" | "pdf" | "docx";

export interface WebChatExport {
  filename: string;
  mimeType: string;
  body: string | Uint8Array;
}

export interface WebChatDownloadAnchor {
  href: string;
  download: string;
  rel: string;
  click(): void;
  remove(): void;
}

export interface WebChatDownloadRuntime {
  createBlob(parts: BlobPart[], mimeType: string): Blob;
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  createAnchor(): WebChatDownloadAnchor;
  appendAnchor(anchor: WebChatDownloadAnchor): void;
  schedule(callback: () => void): void;
}

export function buildWebChatExport(
  format: WebChatExportFormat,
  document: MobileChatExportDocument,
  safeTitle: string,
): WebChatExport {
  switch (format) {
    case "md":
      return {
        filename: `${safeTitle}.md`,
        mimeType: "text/markdown",
        body: buildMarkdownTranscript(document),
      };
    case "txt":
      return {
        filename: `${safeTitle}.txt`,
        mimeType: "text/plain",
        body: buildPlainTextTranscript(document),
      };
    case "pdf":
      return {
        filename: `${safeTitle}.pdf`,
        mimeType: "application/pdf",
        body: buildPdfBytes(document),
      };
    case "docx":
      return {
        filename: `${safeTitle}.docx`,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: buildDocxBytes(document),
      };
  }
}

function defaultDownloadRuntime(): WebChatDownloadRuntime {
  return {
    createBlob: (parts, mimeType) => new Blob(parts, { type: mimeType }),
    createObjectURL: (blob) => URL.createObjectURL(blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAnchor: () => document.createElement("a"),
    appendAnchor: (anchor) => document.body.appendChild(anchor as HTMLAnchorElement),
    schedule: (callback) => {
      globalThis.setTimeout(callback, 0);
    },
  };
}

export function downloadWebChatExport(
  exported: WebChatExport,
  runtime = defaultDownloadRuntime(),
): void {
  const body =
    typeof exported.body === "string"
      ? exported.body
      : (() => {
          const copy = new Uint8Array(exported.body.byteLength);
          copy.set(exported.body);
          return copy.buffer;
        })();
  const blob = runtime.createBlob([body], exported.mimeType);
  const url = runtime.createObjectURL(blob);
  const anchor = runtime.createAnchor();
  anchor.href = url;
  anchor.download = exported.filename;
  anchor.rel = "noopener";
  runtime.appendAnchor(anchor);
  anchor.click();
  anchor.remove();
  runtime.schedule(() => runtime.revokeObjectURL(url));
}