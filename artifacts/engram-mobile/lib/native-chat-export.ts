import {
  buildDocxBytes,
  buildMarkdownTranscript,
  buildPlainTextTranscript,
  escapeHtml,
  type MobileChatExportDocument,
} from "./chat-export";

export type NativeChatExportFormat = "md" | "txt" | "pdf" | "docx";

type NativeFileEncoding = "utf8" | "base64";

export interface NativeChatExportFileInfo {
  exists: boolean;
  isDirectory?: boolean;
  size?: number;
}

export interface NativeChatExportDependencies {
  cacheDirectory: string;
  writeAsStringAsync: (
    uri: string,
    contents: string,
    options: { encoding: NativeFileEncoding },
  ) => Promise<void>;
  printToFileAsync: (options: { html: string }) => Promise<{ uri: string }>;
  getInfoAsync: (uri: string) => Promise<NativeChatExportFileInfo>;
  shareAsync: (
    uri: string,
    options: { mimeType: string; dialogTitle: string; UTI: string },
  ) => Promise<void>;
  dialogTitle: string;
}

export interface NativeChatExportResult {
  uri: string;
  mimeType: string;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + chunkSize),
    );
  }
  return btoa(binary);
}

function buildPdfHtml(document: MobileChatExportDocument): string {
  return (
    `<html><body><h1>${escapeHtml(document.title)}</h1>` +
    document.entries
      .map(
        (entry) =>
          `<h2>${escapeHtml(entry.heading)}</h2>` +
          (entry.timestamp
            ? `<p><em>${escapeHtml(entry.timestamp)}</em></p>`
            : "") +
          `<p>${escapeHtml(entry.content)}</p>`,
      )
      .join("") +
    "</body></html>"
  );
}

async function assertUsableFile(
  uri: string,
  getInfoAsync: NativeChatExportDependencies["getInfoAsync"],
): Promise<void> {
  const info = await getInfoAsync(uri);
  if (!info.exists || info.isDirectory || !(info.size && info.size > 0)) {
    throw new Error(`Native export did not create a non-empty file: ${uri}`);
  }
}

export async function exportNativeChatConversation(
  format: NativeChatExportFormat,
  document: MobileChatExportDocument,
  safeTitle: string,
  dependencies: NativeChatExportDependencies,
): Promise<NativeChatExportResult> {
  let uri: string;
  let mimeType: string;

  if (format === "pdf") {
    ({ uri } = await dependencies.printToFileAsync({
      html: buildPdfHtml(document),
    }));
    mimeType = "application/pdf";
  } else {
    uri = `${dependencies.cacheDirectory}${safeTitle}.${format}`;
    if (format === "docx") {
      await dependencies.writeAsStringAsync(uri, encodeBase64(buildDocxBytes(document)), {
        encoding: "base64",
      });
      mimeType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else {
      const contents =
        format === "md"
          ? buildMarkdownTranscript(document)
          : buildPlainTextTranscript(document);
      await dependencies.writeAsStringAsync(uri, contents, {
        encoding: "utf8",
      });
      mimeType = format === "md" ? "text/markdown" : "text/plain";
    }
  }

  await assertUsableFile(uri, dependencies.getInfoAsync);
  await dependencies.shareAsync(uri, {
    mimeType,
    dialogTitle: dependencies.dialogTitle,
    UTI: mimeType,
  });
  return { uri, mimeType };
}