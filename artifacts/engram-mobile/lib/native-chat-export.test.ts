import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";

import {
  exportNativeChatConversation,
  type NativeChatExportDependencies,
} from "./native-chat-export";

const document = {
  title: "Signal <01>",
  downloadedOn: "Downloaded",
  exportedAt: "2026-09-10T00:01:00.000Z",
  conversationCreated: "Created",
  createdAt: "2026-09-10T00:00:00.000Z",
  entries: [
    {
      heading: "You",
      timestamp: "2026-09-10T00:01:00.000Z",
      content: "Hello native export",
    },
    {
      heading: "E2E Persona",
      timestamp: "2026-09-10T00:02:00.000Z",
      content: "Native export response",
    },
  ],
};

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("native chat exports", () => {
  it("creates non-empty files and shares each format with the right MIME type", async () => {
    const directory = await mkdtemp(join(tmpdir(), "engram-native-export-"));
    tempDirectories.push(directory);
    const shares: Array<{
      uri: string;
      options: { mimeType: string; dialogTitle: string; UTI: string };
    }> = [];

    const dependencies: NativeChatExportDependencies = {
      cacheDirectory: `${directory}/`,
      writeAsStringAsync: async (uri, contents, options) => {
        await writeFile(
          uri,
          options.encoding === "base64"
            ? Buffer.from(contents, "base64")
            : contents,
        );
      },
      printToFileAsync: async ({ html }) => {
        const uri = join(directory, "Signal-01.pdf");
        await writeFile(uri, `%PDF-1.7\n${html}\n%%EOF`);
        return { uri };
      },
      getInfoAsync: async (uri) => {
        try {
          const info = await stat(uri);
          return {
            exists: true,
            isDirectory: info.isDirectory(),
            size: info.size,
          };
        } catch {
          return { exists: false };
        }
      },
      shareAsync: async (uri, options) => {
        shares.push({ uri, options });
      },
      dialogTitle: "Share conversation",
    };

    const expected = [
      ["md", "Signal-01.md", "text/markdown"],
      ["txt", "Signal-01.txt", "text/plain"],
      [
        "pdf",
        "Signal-01.pdf",
        "application/pdf",
      ],
      [
        "docx",
        "Signal-01.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ],
    ] as const;

    for (const [format, filename, mimeType] of expected) {
      const result = await exportNativeChatConversation(
        format,
        document,
        "Signal-01",
        dependencies,
      );
      const file = await readFile(result.uri);
      const info = await stat(result.uri);

      expect(result.mimeType).toBe(mimeType);
      expect(extname(result.uri)).toBe(`.${format}`);
      expect(info.size).toBeGreaterThan(0);
      expect(file.length).toBeGreaterThan(0);

      if (format === "pdf") {
        expect(file.toString("utf8")).toContain("Native export response");
      } else if (format === "docx") {
        const parts = unzipSync(new Uint8Array(file));
        expect(parts["word/document.xml"]).toBeDefined();
        expect(new TextDecoder().decode(parts["word/document.xml"])).toContain(
          "Native export response",
        );
      } else {
        expect(file.toString("utf8")).toContain("Native export response");
      }

      expect(shares.at(-1)).toEqual({
        uri: result.uri,
        options: {
          mimeType,
          dialogTitle: "Share conversation",
          UTI: mimeType,
        },
      });
    }

    expect(shares).toHaveLength(4);
    expect(shares[2]?.uri).toMatch(/Signal-01\.pdf$/);
    expect(shares[3]?.uri).toMatch(/Signal-01\.docx$/);
  });
});