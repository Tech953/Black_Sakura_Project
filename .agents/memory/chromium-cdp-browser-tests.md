---
name: Chromium CDP browser tests
description: Run local web UI regressions without adding Playwright when the workspace already provides Chromium.
---

The workspace's Chromium can be driven directly through Node's built-in WebSocket and the Chrome DevTools Protocol. Connect to the page target from `/json/list`, not the browser target from `/json/version`; use pointerdown/mousedown events for Radix menus, and wait for DOM state before assertions.

**Why:** There is no browser-test dependency in the web artifact, while real UI checks still need a browser. A local fixture can mock API responses and use a DEV-only auth state without creating Clerk users or handling credentials.

**How to apply:** Keep the fixture guarded by `import.meta.env.DEV`, run it against an isolated Vite port, set page-level download behavior, and always terminate Chromium before removing temporary profiles. Expo Router web tab labels may have visible text without `aria-label`; scope row actions by their visible row text rather than assuming accessibility attributes exist.

For Expo mobile export coverage, the browser path cannot use `expo-file-system` native writes. Route web exports through the existing `Share` fallback and reserve native file generation checks for an Android/iOS device or native test harness.

**Why:** The browser regression must exercise the real UI without pretending native file APIs exist on web, and broad accessibility-label selectors can mutate the wrong history row when several conversations are visible.

Native mobile export paths should verify the produced URI exists and has non-zero size before invoking the platform share sheet; a successful share callback alone does not prove that PDF/DOCX generation completed.

**How to apply:** Keep the native export service injectable so deterministic tests can inspect all four file formats, and pair it with a physical-device checklist for share-sheet and Files-provider verification.

Browser exports should use Blob/object-URL downloads rather than native Expo file APIs; CDP tests can intercept `URL.createObjectURL` and anchor clicks to verify filename, MIME type, size, and binary signatures without relying on the host filesystem.

**Why:** Expo web does not provide native file-system or sharing APIs, and browser download paths otherwise regress silently while text-share tests continue to pass. Web PDFs use a small, locally bundled Unicode font set before rasterization; native exports retain their separate file-generation path.

**How to apply:** Extend the browser download fixture’s expected metadata and signature checks whenever a format or filename contract changes.

For guaranteed web-PDF glyphs, keep only the selected Noto WOFF2 subsets in the mobile assets, load them with Expo Font before drawing, fail the export if loading fails, and add `woff2` to Metro’s asset extensions. Do not import the full font packages at runtime.

**Why:** Metro does not treat WOFF2 as an asset by default, and the complete CJK package is too large for a mobile bundle even though the needed 400-weight subsets total about 1.2 MB.

**How to apply:** If the font set changes, update the vendored assets and the asset declaration together; keep the browser-only font import dynamic so Vitest/native module evaluation does not parse React Native Flow syntax.

Web PDF pages can remain visually image-backed while becoming searchable by adding a hidden Unicode text layer: use per-shard built-in Type 1 fonts with distinct names, one-byte ToUnicode CMaps, and `/ActualText` for each line.

**Why:** A single placeholder Type 0 font was not extracted consistently by `pdftotext`, and repeated `/BaseFont /Helvetica` shards caused mapping reuse. Distinct Type 1 resources preserve extraction without embedding another large font.

**How to apply:** Keep the image and text layers in the same page stream, use `/ActualText` for logical RTL copy/search, and validate with a real PDF extractor rather than only checking `/ToUnicode` markers.

When Firefox/WebKit binaries are unavailable, do not label the result as real cross-browser execution. Use an explicit engine-compatibility harness around the production download function, enforce each engine’s relevant DOM/object-URL constraint, and keep the limitation documented.

**Why:** This workspace provides Chromium only; a compatibility contract is useful and repeatable, but it is not evidence that Safari or Firefox themselves ran the flow.