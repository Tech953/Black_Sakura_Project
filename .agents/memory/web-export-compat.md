---
name: Web export compatibility
description: Repeatable browser download contract for web Markdown, text, PDF, and DOCX exports.
---

The web export compatibility check uses engine-shaped download runtimes when native Safari and Firefox runners are unavailable. It must validate attached-anchor timing, object-URL lifetime, filenames, MIME types, non-empty payloads, and PDF/DOCX signatures.

**Why:** Chromium is the only local browser binary, but Safari and Firefox differ in download-anchor and object-URL behavior; a seam-level harness catches regressions without falsely claiming native engine coverage.

**How to apply:** Keep the compatibility test in the mobile library suite, exercise both desktop and mobile Safari/Firefox-shaped profiles, and add native WebKit/Gecko execution only when suitable runners exist. Record native coverage separately from the shaped-runtime result.

The bundled Unicode font loader must clear its cached promise after rejection so a later export can retry loading the assets; a failed font load must happen before canvas creation or download URL creation.

**Why:** Caching a rejected load permanently disables PDF exports after a transient asset or Metro failure, while drawing before the fonts load can produce corrupted multilingual PDFs.

**How to apply:** Test both the fail-closed path and a subsequent successful load, asserting that no object URL is created on failure and that all four font families load before drawing.

Unicode PDF font additions must be downloaded as compact WOFF2 subsets, explicitly registered in the Expo font map and browser stack, and kept under the release-enforced total asset ceiling. RTL extraction may reverse run order even when every character is present.

**Why:** The mobile bundle already carries a large CJK subset, so adding whole-font TTFs would impose an avoidable size cost; text extraction order is not a reliable proxy for visual RTL order.

**How to apply:** Keep script-specific assets and their expected ranges visible in the asset-budget validation, and assert RTL scripts character-by-character in extracted-PDF checks.