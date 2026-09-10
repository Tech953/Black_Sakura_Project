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

export function downloadWebChatExport(exported: WebChatExport): void {
  const body =
    typeof exported.body === "string"
      ? exported.body
      : (() => {
          const copy = new Uint8Array(exported.body.byteLength);
          copy.set(exported.body);
          return copy.buffer;
        })();
  const blob = new Blob([body], { type: exported.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exported.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}