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