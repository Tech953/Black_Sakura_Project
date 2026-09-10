import notoSansArabic from "../assets/fonts/engram-noto-arabic.woff2";
import notoSansCjk from "../assets/fonts/engram-noto-cjk.woff2";
import notoSansCyrillic from "../assets/fonts/engram-noto-cyrillic.woff2";
import notoSansLatin from "../assets/fonts/engram-noto-latin.woff2";
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

export const BROWSER_UNICODE_FONT_STACK =
  '"Engram Noto CJK", "Engram Noto Arabic", "Engram Noto Cyrillic", "Engram Noto Latin", sans-serif';

let browserUnicodeFontsPromise: Promise<void> | null = null;

export function ensureBrowserUnicodeFonts(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  browserUnicodeFontsPromise ??= (async () => {
    const { FontDisplay, loadAsync } = await import("expo-font");
    await loadAsync({
      "Engram Noto CJK": { uri: notoSansCjk, display: FontDisplay.BLOCK },
      "Engram Noto Arabic": { uri: notoSansArabic, display: FontDisplay.BLOCK },
      "Engram Noto Cyrillic": {
        uri: notoSansCyrillic,
        display: FontDisplay.BLOCK,
      },
      "Engram Noto Latin": { uri: notoSansLatin, display: FontDisplay.BLOCK },
    });
  })().catch((error) => {
    browserUnicodeFontsPromise = null;
    throw new Error("Unable to load the bundled Unicode PDF fonts", { cause: error });
  });
  return browserUnicodeFontsPromise;
}

export interface BrowserPdfCanvas {
  width: number;
  height: number;
  getContext(
    contextId: "2d",
  ):
    | {
        fillStyle: unknown;
        font: string;
        textAlign: string;
        direction: string;
        fillRect(x: number, y: number, width: number, height: number): void;
        fillText(text: string, x: number, y: number): void;
        measureText(text: string): { width: number };
      }
    | null;
  toDataURL(type: "image/jpeg", quality?: number): string;
}

export interface BrowserPdfRuntime {
  createCanvas(width: number, height: number): BrowserPdfCanvas;
}

export async function buildWebChatExport(
  format: WebChatExportFormat,
  document: MobileChatExportDocument,
  safeTitle: string,
): Promise<WebChatExport> {
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
      await ensureBrowserUnicodeFonts();
      return {
        filename: `${safeTitle}.pdf`,
        mimeType: "application/pdf",
        body: buildBrowserPdfBytes(document),
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

const BROWSER_PDF_WIDTH = 1224;
const BROWSER_PDF_HEIGHT = 1584;
const BROWSER_PDF_MARGIN = 96;
const BROWSER_PDF_LINE_HEIGHT = 32;

function browserPdfLines(input: MobileChatExportDocument): string[] {
  return [
    input.title,
    `${input.downloadedOn}: ${input.exportedAt}`,
    `${input.conversationCreated}: ${new Date(input.createdAt).toISOString()}`,
    "",
    ...input.entries.flatMap((entry) => [
      entry.heading,
      ...(entry.timestamp ? [entry.timestamp] : []),
      ...entry.content.split(/\r?\n/),
      "",
    ]),
  ];
}

function wrapBrowserPdfLine(
  line: string,
  measureText: (text: string) => number,
  maxWidth: number,
): string[] {
  if (!line) return [""];
  const lines: string[] = [];
  let current = "";
  for (const character of Array.from(line)) {
    const candidate = `${current}${character}`;
    if (current && measureText(candidate) > maxWidth) {
      lines.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function defaultBrowserPdfRuntime(): BrowserPdfRuntime | null {
  if (typeof document === "undefined") return null;
  return {
    createCanvas: (width, height) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
  };
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function asciiBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

type BrowserPdfPage = {
  bytes: Uint8Array;
  width: number;
  height: number;
  lines: string[];
};

type PdfTextMapping = {
  characterByFont: string[][];
  fontByCharacter: Map<string, { fontIndex: number; code: number }>;
  cmaps: string[];
};

function utf16Hex(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0xffff) return codePoint.toString(16).padStart(4, "0").toUpperCase();
  const adjusted = codePoint - 0x10000;
  const high = 0xd800 + (adjusted >> 10);
  const low = 0xdc00 + (adjusted & 0x3ff);
  return `${high.toString(16).padStart(4, "0")}${low.toString(16).padStart(4, "0")}`.toUpperCase();
}

function buildPdfTextMapping(pages: BrowserPdfPage[]): PdfTextMapping {
  const characters = Array.from(new Set(pages.flatMap((page) => page.lines.flatMap((line) => Array.from(line)))));
  const characterByFont: string[][] = [];
  const fontByCharacter = new Map<string, { fontIndex: number; code: number }>();
  for (const character of characters) {
    let fontIndex = characterByFont.length - 1;
    if (fontIndex < 0 || characterByFont[fontIndex].length >= 255) {
      characterByFont.push([]);
      fontIndex += 1;
    }
    const code = characterByFont[fontIndex].length + 1;
    characterByFont[fontIndex].push(character);
    fontByCharacter.set(character, { fontIndex, code });
  }
  const cmaps = characterByFont.map((fontCharacters) => {
    const entries = fontCharacters.map((character, index) => {
      const code = (index + 1).toString(16).padStart(2, "0").toUpperCase();
      return `<${code}> <${utf16Hex(character)}>`;
    });
    const chunks: string[] = [
      "/CIDInit /ProcSet findresource begin\n",
      "12 dict begin\nbegincmap\n",
      "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n",
      "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n",
      "1 begincodespacerange\n<01> <FF>\nendcodespacerange\n",
    ];
    for (let start = 0; start < entries.length; start += 100) {
      const group = entries.slice(start, start + 100);
      chunks.push(`${group.length} beginbfchar\n${group.join("\n")}\nendbfchar\n`);
    }
    chunks.push("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend");
    return chunks.join("");
  });
  return { characterByFont, fontByCharacter, cmaps };
}

function encodePdfTextRuns(
  text: string,
  mapping: PdfTextMapping,
): Array<{ fontIndex: number; bytes: string }> {
  const runs: Array<{ fontIndex: number; bytes: string }> = [];
  for (const character of Array.from(text)) {
    const mapped = mapping.fontByCharacter.get(character);
    if (!mapped) continue;
    const current = runs.at(-1);
    const byte = mapped.code.toString(16).padStart(2, "0").toUpperCase();
    if (current?.fontIndex === mapped.fontIndex) {
      current.bytes += byte;
    } else {
      runs.push({ fontIndex: mapped.fontIndex, bytes: byte });
    }
  }
  return runs;
}

function buildTextLayerContent(
  lines: string[],
  mapping: PdfTextMapping,
): Uint8Array {
  const commands = [
    "BT",
    "/F1 16 Tf",
    "3 Tr",
    ...lines.flatMap((line, index) => {
      if (!line) return [];
      const rtl = /[\u0590-\u08ff]/u.test(line);
      const x = rtl ? 516 : 48;
      const y = 792 - (48 + (index + 1) * 16);
      const runs = encodePdfTextRuns(line, mapping);
      return [
        `/Span << /ActualText <FEFF${Array.from(line).map(utf16Hex).join("")}> >> BDC`,
        `1 0 0 1 ${x} ${y} Tm`,
        ...runs.map((run) => `/${`F${run.fontIndex + 1}`} 16 Tf <${run.bytes}> Tj`),
        "EMC",
      ];
    }),
    "ET",
  ];
  return asciiBytes(commands.join("\n"));
}

function buildImagePdf(pages: BrowserPdfPage[]): Uint8Array {
  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  const mapping = buildPdfTextMapping(pages);
  const fontNumber = 3 + pages.length * 3;
  const cmapNumber = fontNumber + mapping.cmaps.length;
  const objectCount = cmapNumber + mapping.cmaps.length - 1;
  const fontResources = mapping.cmaps
    .map((_, index) => `/F${index + 1} ${fontNumber + index} 0 R`)
    .join(" ");
  const objects: Array<
    | { kind: "text"; value: string }
    | { kind: "stream"; dictionary: string; bytes: Uint8Array }
  > = [
    { kind: "text", value: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      kind: "text",
      value: `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    },
  ];

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const pageNumber = pageObjectNumbers[index];
    const imageNumber = pageNumber + 1;
    const contentNumber = pageNumber + 2;
    objects.push({
      kind: "text",
      value:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /XObject << /Im0 ${imageNumber} 0 R >> /Font << ${fontResources} >> >> ` +
        `/Contents ${contentNumber} 0 R >>`,
    });
    objects.push({
      kind: "stream",
      dictionary:
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.byteLength} >>`,
      bytes: page.bytes,
    });
    const content = concatBytes([
      asciiBytes("q\n612 0 0 792 0 0 cm\n/Im0 Do\nQ\n"),
      buildTextLayerContent(page.lines, mapping),
    ]);
    objects.push({
      kind: "stream",
      dictionary: `<< /Length ${content.byteLength} >>`,
      bytes: content,
    });
  }
  for (let index = 0; index < mapping.cmaps.length; index += 1) {
    objects.push({
      kind: "text",
      value:
        `<< /Type /Font /Subtype /Type1 /BaseFont /EngramUnicode${index + 1} /Encoding /WinAnsiEncoding ` +
        `/ToUnicode ${cmapNumber + index} 0 R >>`,
    });
  }
  for (const cmap of mapping.cmaps) {
    objects.push({
      kind: "stream",
      dictionary: `<< /Length ${cmap.length} >>`,
      bytes: asciiBytes(cmap),
    });
  }

  const chunks: Uint8Array[] = [asciiBytes("%PDF-1.4\n")];
  const offsets = [0];
  let byteOffset = chunks[0].byteLength;
  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index];
    offsets.push(byteOffset);
    const prefix = asciiBytes(`${index + 1} 0 obj\n`);
    chunks.push(prefix);
    byteOffset += prefix.byteLength;
    if (object.kind === "stream") {
      const dictionary = asciiBytes(`${object.dictionary}\nstream\n`);
      chunks.push(dictionary, object.bytes, asciiBytes("\nendstream\n"));
      byteOffset += dictionary.byteLength + object.bytes.byteLength + "\nendstream\n".length;
    } else {
      const body = asciiBytes(`${object.value}\nendobj\n`);
      chunks.push(body);
      byteOffset += body.byteLength;
    }
    if (object.kind === "stream") {
      const end = asciiBytes("endobj\n");
      chunks.push(end);
      byteOffset += end.byteLength;
    }
  }
  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("");
  chunks.push(asciiBytes(xref));
  return concatBytes(chunks);
}

export function buildBrowserPdfBytes(
  input: MobileChatExportDocument,
  runtime = defaultBrowserPdfRuntime(),
): Uint8Array {
  if (!runtime) {
    return buildPdfBytes(input);
  }

  const measureCanvas = runtime.createCanvas(BROWSER_PDF_WIDTH, BROWSER_PDF_HEIGHT);
  const measureContext = measureCanvas.getContext("2d");
  if (!measureContext) return buildPdfBytes(input);
  measureContext.font = `32px ${BROWSER_UNICODE_FONT_STACK}`;
  const maxWidth = BROWSER_PDF_WIDTH - BROWSER_PDF_MARGIN * 2;
  const lines = browserPdfLines(input).flatMap((line) =>
    wrapBrowserPdfLine(line, (value) => measureContext.measureText(value).width, maxWidth),
  );
  const linesPerPage = Math.floor(
    (BROWSER_PDF_HEIGHT - BROWSER_PDF_MARGIN * 2) / BROWSER_PDF_LINE_HEIGHT,
  );
  const pages: BrowserPdfPage[] = [];
  for (let start = 0; start < Math.max(lines.length, 1); start += linesPerPage) {
    const canvas = runtime.createCanvas(BROWSER_PDF_WIDTH, BROWSER_PDF_HEIGHT);
    const context = canvas.getContext("2d");
    if (!context) return buildPdfBytes(input);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, BROWSER_PDF_WIDTH, BROWSER_PDF_HEIGHT);
    context.font = measureContext.font;
    for (let index = 0; index < linesPerPage && start + index < lines.length; index += 1) {
      const line = lines[start + index];
      const rtl = /[\u0590-\u08ff]/u.test(line);
      context.direction = rtl ? "rtl" : "ltr";
      context.textAlign = rtl ? "right" : "left";
      context.fillStyle = "#111827";
      context.fillText(
        line,
        rtl ? BROWSER_PDF_WIDTH - BROWSER_PDF_MARGIN : BROWSER_PDF_MARGIN,
        BROWSER_PDF_MARGIN + (index + 1) * BROWSER_PDF_LINE_HEIGHT,
      );
    }
    pages.push({
      bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.92)),
      width: canvas.width,
      height: canvas.height,
      lines: lines.slice(start, start + linesPerPage),
    });
  }
  return buildImagePdf(pages);
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