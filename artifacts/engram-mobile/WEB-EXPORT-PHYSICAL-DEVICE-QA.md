# Web export physical-device regression

This is the release check for web chat exports in real mobile browsers. It
covers iOS Safari and Android Firefox, where the browser download UI and file
provider are not available to the Linux workspace automation.

## Pre-device gate

Run the existing browser regression before using a phone:

```bash
pnpm --filter @workspace/engram-mobile run test:e2e:history
```

That check signs into the web fixture, hydrates a conversation, archives and
restores it, and exercises Markdown, plain text, PDF, and DOCX downloads. It
also checks the PDF signature, embedded JPEG, Unicode text map, and extracted
multilingual text. It is not evidence of a physical-device pass.

## Test data and expected files

Use a conversation titled `Hydrated history`, or pass its actual safe filename
stem to the report command with `--prefix`. The four expected downloaded files
are:

| Format | Filename | Browser-declared MIME |
| --- | --- | --- |
| Markdown | `Hydrated-history.md` | `text/markdown` |
| Plain text | `Hydrated-history.txt` | `text/plain` |
| PDF | `Hydrated-history.pdf` | `application/pdf` |
| Word | `Hydrated-history.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` |

The browser-declared MIME is the value assigned to the download Blob by the
production export code. The report command also detects the MIME of the
transferred file. `file` may report Markdown as `text/plain` and DOCX as
`application/zip` depending on its version; those are accepted because the
filesystem provider has normalized the original browser metadata.

## iOS Safari

1. Open the current signed-in ENGRAM web build in Safari on a physical iPhone
   or iPad.
2. Open Chat, open History, select a conversation with both a user message and
   an engram response, and open **Export conversation**.
3. Download Markdown, plain text, PDF, and Word document one at a time.
4. When Safari previews a PDF or offers an external app, use **Share →
   Save to Files** so the resulting file is available in the same Files
   location as the other formats.
5. In Files, confirm each filename, non-zero size, and openability. The PDF
   must open as a PDF and the DOCX must open as a Word document; both must
   contain the selected conversation.
6. Copy the four files into a local directory, for example
   `qa/web-export/ios-safari/`, and run:

   ```bash
   pnpm --filter @workspace/engram-mobile run test:e2e:web-export-device-report -- \
     --platform=ios \
     --browser=safari \
     --dir=qa/web-export/ios-safari
   ```

## Android Firefox

1. Open the current signed-in ENGRAM web build in Firefox on a physical
   Android phone or tablet.
2. Repeat the same Chat → History → conversation → **Export conversation**
   flow for all four formats.
3. If Firefox opens a PDF viewer, use its download action and keep the file in
   Downloads. Do not treat a viewer-only preview or copied transcript as a
   successful file export.
4. In Downloads or Files, confirm each filename, non-zero size, and openability.
   The PDF must open as a PDF and the DOCX must open as a Word document; both
   must contain the selected conversation.
5. Copy the four files into a local directory, for example
   `qa/web-export/android-firefox/`, and run:

   ```bash
   pnpm --filter @workspace/engram-mobile run test:e2e:web-export-device-report -- \
     --platform=android \
     --browser=firefox \
     --dir=qa/web-export/android-firefox
   ```

## Release record

Record the output JSON from each report together with:

- device model, OS version, and browser version
- the web build or deployment revision
- the source conversation title and filename stem
- where each browser placed the files (iOS Files location or Android Downloads
  location)
- any viewer, share-sheet, or filename behavior that required the platform
  guidance above

The report output has this shape:

```json
{
  "physicalWebExportCoverage": [
    {
      "platform": "ios",
      "browser": "safari",
      "status": "passed",
      "directory": "ios-safari",
      "formats": [
        {
          "format": "pdf",
          "filename": "Hydrated-history.pdf",
          "declaredMimeType": "application/pdf",
          "detectedMimeType": "application/pdf",
          "size": 1234,
          "signature": [37, 80, 68, 70]
        }
      ]
    }
  ]
}
```

## Workspace limitation

No physical iOS or Android browser was available in this workspace, so the
device steps above were not claimed as executed here. The shaped Safari and
Firefox compatibility tests and the Chromium web-chat regression remain the
automated pre-device evidence. A release record must include both physical
report outputs before this check is considered complete.