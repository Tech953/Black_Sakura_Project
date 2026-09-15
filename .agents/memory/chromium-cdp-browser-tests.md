---
name: Chromium CDP browser tests
description: Run local web UI regressions without adding Playwright when the workspace already provides Chromium.
---

The workspace's Chromium can be driven directly through Node's built-in WebSocket and the Chrome DevTools Protocol. Connect to the page target from `/json/list`, not the browser target from `/json/version`; use pointerdown/mousedown events for Radix menus, and wait for DOM state before assertions.

**Why:** There is no browser-test dependency in the web artifact, while real UI checks still need a browser. A local fixture can mock API responses and use a DEV-only auth state without creating Clerk users or handling credentials.

**How to apply:** Keep the fixture guarded by `import.meta.env.DEV`, run it against an isolated Vite port, set page-level download behavior, and always terminate Chromium before removing temporary profiles. Expo Router web tab labels may have visible text without `aria-label`; scope row actions by their visible row text rather than assuming accessibility attributes exist.

The download-page regression also requires an isolated Vite server started with `VITE_BROWSER_TEST=true`; the normal preview remains signed out and stops at the landing page before protected download routes render.

**Why:** The download route is protected in normal development, while the regression's local fixture intentionally supplies a DEV-only authenticated Clerk state.

**How to apply:** Start the web artifact with `VITE_BROWSER_TEST=true` and a free `PORT`, then pass that URL through `ENGRAM_BROWSER_TEST_URL` instead of changing production auth behavior.

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

For async fixture-backed UI, wait for the query result that enables the next control before opening or selecting from a dialog, and use case-insensitive visible-text assertions when localization or CSS transforms can change casing.

**Why:** A browser can render the shell before a parallel query hydrates participant controls, and translated labels may be uppercase even when the source string is title case; fixed sleeps and exact-case selectors made the regression flaky.

**How to apply:** Gate dialog interaction on the participant option being present, then select controls by normalized visible text and keep reload assertions on the rendered transcript.

For polling-failure regressions, toggle the injected API failure while the page under test is actively observing the query; a shared React Query cache can mask the failure after an SPA route remount.

**Why:** Route changes may reuse a successful cached query without immediately exposing a newly injected failure, making a cross-route assertion test cache/refetch timing instead of the user-visible stale-state contract.

**How to apply:** Assert stale-data recovery on the active polling page. Cover another route's unavailable state with a dedicated initial-load fixture or a separate browser scenario rather than depending on remount refetch timing.

Wouter's `useLocation()` value is pathname-oriented in this app and should not be used as the source of query parameters. Read `window.location.search` when a route's behavior depends on a query string, and keep the pathname in the hook dependency list for SPA updates.

**Why:** A browser navigation to `/media?asset=...` updated the URL but left the focused-card logic blind to the query when it parsed the hook value.

**How to apply:** Browser regressions should assert both the URL search parameter and the resulting stateful UI, such as a focused or expanded detail card.

For self-contained desktop HTML pages with an injected bridge, enable Page and Runtime domains and install the fixture as `window.eval(atob(...))` through `Page.addScriptToEvaluateOnNewDocument`; a direct source string may run outside the page world and leave the bridge undefined. Run this Chromium harness on Linux only when the shared browser binary is Linux-specific.

**Why:** The Settings document’s inline initialization runs in the page world and needs the bridge before its first script executes; the existing Linux Chromium helper is not present on the Windows/macOS desktop matrix.

**How to apply:** Serve the real HTML, inject the encoded fixture before navigation, and gate the workflow step to Linux while keeping production renderer code unchanged.

When a signed-in web fixture asserts that an action made no request, track route-specific requests separately from the full fetch log. Clerk's DEV browser bootstrap can issue unrelated requests after navigation and otherwise creates false failures.

**Why:** The Settings health-check regression must distinguish an invalid-address probe from authentication bootstrap traffic that occurs before the page interaction.

**How to apply:** Keep a complete request log for diagnostics, but count and assert only the endpoint under test for no-network guarantees.

Self-contained desktop HTML browser fixtures are embedded with an outer String.raw template literal, so injected fixture code must avoid unescaped nested template literals.

**Why:** A nested backtick terminates the host script before Chromium starts, turning a valid browser fixture into a Node syntax failure.

**How to apply:** Use string concatenation or escaped delimiters inside the injected fixture, then run node --check before the browser regression.